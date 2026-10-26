// Резонанс для ПК — the data behind Резонанс's own taskbar: the apps pinned to the
// Windows taskbar (so the same ones show up), the open windows grouped by app
// (icon, title, which is in front, which are minimised), bringing a window to the
// front or minimising it, "show desktop", and putting the Windows taskbar into
// auto-hide so Резонанс's bar sits in its place (the real tray slides up on a
// hover at the very bottom). Pure window bookkeeping — nothing is injected
// anywhere, and the Windows taskbar's own state is saved and put back.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace Rezonans
{
    internal static class Taskbar
    {
        private static readonly Dictionary<string, string> IconCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static string _lastSig = "";

        // ---------- open windows ----------

        internal static List<Dictionary<string, object>> Windows()
        {
            var fg = GetForegroundWindow();
            var list = new List<Dictionary<string, object>>();
            EnumWindows((h, l) =>
            {
                try
                {
                    if (!Taskworthy(h)) return true;
                    var title = TitleOf(h);
                    if (string.IsNullOrWhiteSpace(title)) return true;
                    var exe = ExeOf(h) ?? "";
                    list.Add(new Dictionary<string, object>
                    {
                        { "hwnd", h.ToInt64().ToString() },
                        { "title", title },
                        { "exe", exe },
                        { "icon", IconFor(h, exe) },
                        { "active", h == fg },
                        { "min", IsIconic(h) },
                    });
                }
                catch { }
                return true;
            }, IntPtr.Zero);
            return list;
        }

        // the list changed since last time? (so the bar is sent updates only on change)
        internal static bool Changed(List<Dictionary<string, object>> list)
        {
            var sb = new StringBuilder();
            foreach (var w in list) sb.Append(w["hwnd"]).Append(w["active"]).Append(w["min"]).Append(w["title"]).Append('|');
            var sig = sb.ToString();
            if (sig == _lastSig) return false;
            _lastSig = sig;
            return true;
        }

        private static readonly HashSet<string> ShellClasses = new HashSet<string>
        {
            "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
        };

        private static bool Taskworthy(IntPtr h)
        {
            if (!IsWindowVisible(h)) return false;
            if (Foreground.Own.Contains(h.ToInt64())) return false;
            if (ShellClasses.Contains(ClassOf(h))) return false;
            long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
            bool app = (ex & WS_EX_APPWINDOW) != 0;
            if ((ex & WS_EX_TOOLWINDOW) != 0) return false;
            if ((ex & WS_EX_NOACTIVATE) != 0 && !app) return false;
            // owned windows (dialogs) ride with their owner, unless they ask to appear
            if (GetWindow(h, GW_OWNER) != IntPtr.Zero && !app) return false;
            // UWP / background XAML windows report themselves "cloaked"
            if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
            return true;
        }

        private static string ClassOf(IntPtr h)
        {
            var sb = new StringBuilder(256);
            GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static string TitleOf(IntPtr h)
        {
            int n = GetWindowTextLength(h);
            if (n <= 0) return "";
            var sb = new StringBuilder(n + 1);
            GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static string ExeOf(IntPtr h)
        {
            try
            {
                GetWindowThreadProcessId(h, out uint pid);
                if (pid == 0) return null;
                var proc = OpenProcess(0x1000 /* QUERY_LIMITED_INFORMATION */, false, pid);
                if (proc == IntPtr.Zero) return null;
                try
                {
                    var sb = new StringBuilder(1024);
                    int cap = sb.Capacity;
                    if (QueryFullProcessImageName(proc, 0, sb, ref cap)) return sb.ToString();
                }
                finally { CloseHandle(proc); }
            }
            catch { }
            return null;
        }

        // the app's icon (by its exe, cached); Store apps all run in one frame host,
        // so for them the window's own icon is asked for instead
        private static string IconFor(IntPtr h, string exe)
        {
            bool frame = exe.EndsWith("ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase);
            string key = frame ? "hwnd:" + h.ToInt64() : exe;
            if (key.Length > 0 && IconCache.TryGetValue(key, out var cached)) return cached;
            string png = frame ? WindowIcon(h) : "";
            if (png.Length == 0 && exe.Length > 0) png = Apps.IconOf(exe);
            if (png.Length == 0) png = WindowIcon(h);
            if (IconCache.Count > 120) IconCache.Clear();
            if (key.Length > 0) IconCache[key] = png;
            return png;
        }

        private static string WindowIcon(IntPtr h)
        {
            IntPtr ic = IntPtr.Zero;
            foreach (var kind in new[] { 1 /* ICON_BIG */, 2 /* ICON_SMALL2 */, 0 /* ICON_SMALL */ })
            {
                if (SendMessageTimeout(h, 0x7F /* WM_GETICON */, new IntPtr(kind), IntPtr.Zero, 2 /* ABORTIFHUNG */, 60, out ic) != IntPtr.Zero && ic != IntPtr.Zero) break;
                ic = IntPtr.Zero;
            }
            if (ic == IntPtr.Zero) ic = GetClassLongPtr(h, -14 /* GCLP_HICON */);
            return PngOf(ic); // the window owns the icon: never destroyed here
        }

        private static string PngOf(IntPtr ic)
        {
            if (ic == IntPtr.Zero) return "";
            try
            {
                using (var icon = Icon.FromHandle(ic))
                using (var bmp = icon.ToBitmap())
                using (var scaled = new Bitmap(48, 48))
                using (var g = Graphics.FromImage(scaled))
                using (var ms = new MemoryStream())
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.DrawImage(bmp, 0, 0, 48, 48);
                    scaled.Save(ms, ImageFormat.Png);
                    return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
            catch { return ""; }
        }

        // ---------- the apps pinned to the Windows taskbar ----------

        internal static List<Dictionary<string, object>> Pins()
        {
            var list = new List<Dictionary<string, object>>();
            try
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar");
                if (!Directory.Exists(dir)) return list;
                var files = new List<string>(Directory.GetFiles(dir, "*.lnk"));
                files.Sort((a, b) => File.GetCreationTimeUtc(a).CompareTo(File.GetCreationTimeUtc(b)));
                foreach (var f in files)
                {
                    Shortcut(f, out var target, out var iconLoc);
                    list.Add(new Dictionary<string, object>
                    {
                        { "name", Path.GetFileNameWithoutExtension(f) },
                        { "path", f },
                        { "icon", PinIcon(f, target, iconLoc) },
                        { "target", target },
                    });
                }
            }
            catch (Exception e) { Program.Log("закреплённые: " + e.Message); }
            return list;
        }

        // the shortcut's own icon (without the shortcut arrow Windows adds to .lnk
        // icons): its icon location if it names one, else the program's icon
        private static string PinIcon(string lnk, string target, string iconLoc)
        {
            try
            {
                if (!string.IsNullOrEmpty(iconLoc))
                {
                    int comma = iconLoc.LastIndexOf(',');
                    var file = Environment.ExpandEnvironmentVariables(comma >= 0 ? iconLoc.Substring(0, comma) : iconLoc).Trim('"', ' ');
                    int idx = 0;
                    if (comma >= 0) int.TryParse(iconLoc.Substring(comma + 1), out idx);
                    if (file.Length > 0 && File.Exists(file))
                    {
                        var large = new IntPtr[1];
                        var small = new IntPtr[1];
                        if (ExtractIconEx(file, idx, large, small, 1) > 0)
                        {
                            try
                            {
                                var png = PngOf(large[0] != IntPtr.Zero ? large[0] : small[0]);
                                if (png.Length > 0) return png;
                            }
                            finally
                            {
                                if (large[0] != IntPtr.Zero) DestroyIcon(large[0]);
                                if (small[0] != IntPtr.Zero) DestroyIcon(small[0]);
                            }
                        }
                    }
                }
                if (!string.IsNullOrEmpty(target) && target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && File.Exists(target)) return Apps.IconOf(target);
            }
            catch { }
            return Apps.IconOf(lnk);
        }

        private static void Shortcut(string lnk, out string target, out string iconLoc)
        {
            target = "";
            iconLoc = "";
            object sh = null, sc = null;
            try
            {
                var t = Type.GetTypeFromProgID("WScript.Shell");
                sh = Activator.CreateInstance(t);
                sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
                target = (sc.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, sc, null) as string) ?? "";
                var loc = (sc.GetType().InvokeMember("IconLocation", BindingFlags.GetProperty, null, sc, null) as string) ?? "";
                iconLoc = loc.StartsWith(",") ? "" : loc; // ",0" = no icon of its own
            }
            catch { }
            finally
            {
                if (sc != null) Marshal.FinalReleaseComObject(sc);
                if (sh != null) Marshal.FinalReleaseComObject(sh);
            }
        }

        // ---------- acting on windows ----------

        // a click on an app's button: the window in front gets minimised, any
        // other comes to the front (restored first if it was minimised)
        internal static void Activate(long hwnd)
        {
            var h = new IntPtr(hwnd);
            if (!IsWindow(h)) return;
            if (h == GetForegroundWindow() && !IsIconic(h))
            {
                ShowWindow(h, SW_MINIMIZE);
                return;
            }
            if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
            Bring(h);
        }

        internal static void Front(long hwnd)
        {
            var h = new IntPtr(hwnd);
            if (!IsWindow(h)) return;
            if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
            Bring(h);
        }

        internal static void Close(long hwnd)
        {
            var h = new IntPtr(hwnd);
            if (IsWindow(h)) PostMessage(h, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
        }

        // "End task", as in Windows 11's taskbar menu: the app's process goes at once
        // (nothing is asked, unsaved work is lost — the user chose that). A Store
        // app's window belongs to the shared frame host: its own process is the one
        // behind the frame's inner window. Explorer, Резонанс and the frame host
        // itself are never ended.
        private static readonly HashSet<string> NeverEnd = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "explorer", "Rezonans", "RezonansHost", "ApplicationFrameHost", "dwm", "csrss", "winlogon", "System", "svchost", "sihost", "ShellExperienceHost", "StartMenuExperienceHost",
        };

        internal static void EndTask(long hwnd)
        {
            var h = new IntPtr(hwnd);
            if (!IsWindow(h)) return;
            GetWindowThreadProcessId(h, out uint pid);
            try
            {
                var p = System.Diagnostics.Process.GetProcessById((int)pid);
                if (p.ProcessName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase))
                {
                    uint inner = 0;
                    EnumChildWindows(h, (c, l) =>
                    {
                        GetWindowThreadProcessId(c, out uint cp);
                        if (cp != pid) { inner = cp; return false; }
                        return true;
                    }, IntPtr.Zero);
                    if (inner == 0) { Program.Log("завершить задачу: у окна приложения из Store не нашёлся процесс"); return; }
                    p = System.Diagnostics.Process.GetProcessById((int)inner);
                }
                if (p.HasExited) return; // another window of the same app took it already
                if (NeverEnd.Contains(p.ProcessName)) { Program.Log("завершить задачу: " + p.ProcessName + " не завершаю"); return; }
                Program.Log("завершить задачу: " + p.ProcessName + " (" + p.Id + ")");
                p.Kill();
            }
            catch (Exception e) { Program.Log("завершить задачу: " + e.Message); }
        }

        [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);

        // Windows only lets the app that has the input put a window in front; the
        // click went to Резонанс's bar, so the helper borrows the current front
        // window's input for a moment
        private static void Bring(IntPtr h)
        {
            var fg = GetForegroundWindow();
            uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out _);
            uint me = GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
            try
            {
                BringWindowToTop(h);
                SetForegroundWindow(h);
            }
            finally
            {
                if (attached) AttachThreadInput(me, fgThread, false);
            }
            if (GetForegroundWindow() != h) SwitchToThisWindow(h, true);
        }

        // a tray program about to open its menu or window: let it come to the front
        // (it may only if the one in front allows it — borrow the front window's
        // input for a moment, as Bring does)
        // The click was on Резонанс's window, so Windows won't let the program take
        // the front by itself — and a menu that isn't in front never shows (or
        // closes at once). Explorer hands the front to the program; so does this:
        // its (hidden) tray window is put in front, the way Microsoft's own advice
        // for tray menus does it.
        internal static bool LetForeground(uint pid, IntPtr hwnd)
        {
            var fg = GetForegroundWindow();
            uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out _);
            uint me = GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
            try
            {
                if (pid != 0) AllowSetForegroundWindow(pid);
                if (hwnd != IntPtr.Zero) SetForegroundWindow(hwnd);
            }
            finally { if (attached) AttachThreadInput(me, fgThread, false); }
            var now = GetForegroundWindow();
            if (now == IntPtr.Zero) return false;
            GetWindowThreadProcessId(now, out uint nowPid);
            return nowPid == pid;
        }

        // "show desktop": every window down; pressed again with nothing restored in
        // between, they all come back (the shell's own minimise-all / undo, run in
        // a short single-threaded COM apartment of its own)
        private static bool _allDown;

        internal static void ToggleDesktop()
        {
            bool anyUp = false;
            EnumWindows((h, l) =>
            {
                try { if (Taskworthy(h) && !IsIconic(h)) anyUp = true; } catch { }
                return !anyUp;
            }, IntPtr.Zero);
            string verb = anyUp || !_allDown ? "MinimizeAll" : "UndoMinimizeALL";
            bool ok = false;
            var t = new System.Threading.Thread(() =>
            {
                object sh = null;
                try
                {
                    var type = Type.GetTypeFromProgID("Shell.Application");
                    sh = Activator.CreateInstance(type);
                    type.InvokeMember(verb, BindingFlags.InvokeMethod, null, sh, null);
                    ok = true;
                }
                catch (Exception e) { Program.Log("рабочий стол: " + e.Message); }
                finally { if (sh != null) Marshal.FinalReleaseComObject(sh); }
            }) { IsBackground = true };
            t.SetApartmentState(System.Threading.ApartmentState.STA);
            t.Start();
            t.Join(3000);
            if (!ok) PostMessage(TrayHost.FindExplorerTray(), 0x0111 /* WM_COMMAND */, new IntPtr(verb == "MinimizeAll" ? 419 : 416), IntPtr.Zero);
            _allDown = verb == "MinimizeAll";
            Program.Log("рабочий стол: " + (_allDown ? "всё свёрнуто" : "окна вернулись"));
        }

        // ---------- the Windows taskbar out of the way (reversible) ----------

        private const string StateKey = @"Software\Rezonans";
        private const string StateValue = "TaskbarState";

        // on: the Windows taskbar's own state is saved once, then auto-hide, and the
        // taskbar is hidden altogether (on every screen), so it never slides up —
        // Резонанс's taskbar has the tray now. Explorer shows it again now and then
        // (Win+T, a restart of Explorer): a watch hides it again.
        // off: shown again, and the saved state goes back.
        private static System.Threading.Timer _hideWatch;
        private static volatile bool _hidden;

        internal static void WindowsTaskbar(bool autohide)
        {
            AutoHide(autohide);
            _hidden = autohide;
            if (autohide)
            {
                HideAll();
                if (_hideWatch == null) _hideWatch = new System.Threading.Timer(_ => { if (_hidden) HideAll(); }, null, 1500, 1500);
                Program.Log("панель задач Windows: спрятана");
            }
            else
            {
                try { _hideWatch?.Dispose(); } catch { }
                _hideWatch = null;
                foreach (var h in TrayHost.ExplorerTaskbars()) ShowWindow(h, SW_SHOWNA);
            }
        }

        private static void HideAll()
        {
            try
            {
                foreach (var h in TrayHost.ExplorerTaskbars())
                    if (IsWindowVisible(h)) ShowWindow(h, SW_HIDE);
            }
            catch { }
        }

        // the crash path: the Windows taskbar must come back whatever happens
        internal static void ShowWindowsTaskbarNow()
        {
            _hidden = false;
            try { foreach (var h in TrayHost.ExplorerTaskbars()) ShowWindow(h, SW_SHOWNA); } catch { }
        }

        private static void AutoHide(bool autohide)
        {
            try
            {
                var tray = TrayHost.FindExplorerTray();
                using (var reg = Registry.CurrentUser.CreateSubKey(StateKey))
                {
                    if (autohide)
                    {
                        if (reg.GetValue(StateValue) == null)
                        {
                            var get = Data(tray, 0);
                            int was = (int)SHAppBarMessage(ABM_GETSTATE, ref get).ToInt64();
                            reg.SetValue(StateValue, was, RegistryValueKind.DWord);
                        }
                        var abd = Data(tray, ABS_AUTOHIDE);
                        SHAppBarMessage(ABM_SETSTATE, ref abd);
                        Program.Log("панель задач Windows: автоскрытие");
                    }
                    else
                    {
                        var v = reg.GetValue(StateValue);
                        if (v == null) return;
                        var abd = Data(tray, Convert.ToInt32(v));
                        SHAppBarMessage(ABM_SETSTATE, ref abd);
                        reg.DeleteValue(StateValue, false);
                        Program.Log("панель задач Windows: как было");
                    }
                }
            }
            catch (Exception e) { Program.Log("панель задач Windows: " + e.Message); }
        }

        private static APPBARDATA Data(IntPtr tray, int state)
        {
            return new APPBARDATA { cbSize = Marshal.SizeOf(typeof(APPBARDATA)), hWnd = tray, lParam = new IntPtr(state) };
        }

        // ---------- native ----------

        private const int GWL_EXSTYLE = -20;
        private const long WS_EX_TOOLWINDOW = 0x00000080;
        private const long WS_EX_APPWINDOW = 0x00040000;
        private const long WS_EX_NOACTIVATE = 0x08000000;
        private const uint GW_OWNER = 4;
        private const int DWMWA_CLOAKED = 14;
        private const int SW_MINIMIZE = 6;
        private const int SW_RESTORE = 9;
        private const int SW_HIDE = 0;
        private const int SW_SHOWNA = 8;
        private const uint ABM_GETSTATE = 0x00000004;
        private const uint ABM_SETSTATE = 0x0000000A;
        private const int ABS_AUTOHIDE = 0x01;

        private delegate bool EnumProc(IntPtr h, IntPtr l);

        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(uint pid);
        [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] private static extern void SwitchToThisWindow(IntPtr h, bool altTab);
        [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
        [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] private static extern IntPtr GetClassLongPtr(IntPtr h, int index);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string name);
        [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
        [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(int access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr proc, int flags, StringBuilder name, ref int size);
        [DllImport("shell32.dll")] private static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint n);
        [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr h);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

        [StructLayout(LayoutKind.Sequential)]
        private struct APPBARDATA
        {
            public int cbSize;
            public IntPtr hWnd;
            public uint uCallbackMessage;
            public uint uEdge;
            public ShellNative.RECT rc;
            public IntPtr lParam;
        }
    }
}
