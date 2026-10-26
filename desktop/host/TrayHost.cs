// Резонанс для ПК — the tray icons (the little icons of programs by the clock) for
// Резонанс's own taskbar, so the Windows taskbar can be hidden completely.
//
// Programs put their icon in the tray with Shell_NotifyIcon, which finds the
// window of class "Shell_TrayWnd" and sends it the icon (WM_COPYDATA). The helper
// creates a window of that class of its own, kept above Explorer's: every message
// that comes to it is passed on to Explorer's real one at once, unchanged, and
// its answer is given back — so Windows keeps working exactly as before (icons,
// app bars, notifications) — and a copy of the icons is kept here and sent to the
// app. A click on an icon in Резонанс's taskbar goes to the program the way
// Explorer would send it. If the helper goes away, its window goes with it and
// programs talk to Explorer directly again; on start, all programs are asked to
// put their icons up again ("TaskbarCreated"), so the list is complete.
//
// The window's own thread does nothing but pass messages on: icons are turned
// into pictures and sent out on another thread, so no program ever waits here.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Rezonans
{
    internal static class TrayHost
    {
        private sealed class Icon
        {
            public string Id;
            public IntPtr Hwnd;
            public uint Uid;
            public uint Callback;
            public IntPtr HIcon;
            public string Tip = "";
            public bool Hidden;
            public uint Version;
            public uint Pid;
            public string Exe = "";
            public long Order;
        }

        private static readonly object Lock = new object();
        private static readonly Dictionary<string, Icon> Icons = new Dictionary<string, Icon>();
        private static readonly Dictionary<string, string> Pngs = new Dictionary<string, string>(); // id|hicon -> png
        private static readonly HashSet<string> FailedOnce = new HashSet<string>();
        private static long _order;

        private static Thread _thread;
        private static uint _threadId;
        private static IntPtr _hwnd = IntPtr.Zero;
        private static WndProc _proc; // kept alive against the GC
        private static volatile bool _on;
        private static IntPtr _explorer = IntPtr.Zero;
        private static Timer _keepTop;
        private static Timer _sendTimer;
        private static string _lastSig = "";

        internal static bool Running => _on;

        internal static void Start()
        {
            if (_on) return;
            _on = true;
            _thread = new Thread(Run) { IsBackground = true, Name = "tray" };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
        }

        internal static void Stop()
        {
            if (!_on) return;
            _on = false;
            try { _keepTop?.Dispose(); } catch { }
            _keepTop = null;
            try { if (_hwnd != IntPtr.Zero) PostMessage(_hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); } catch { }
            Program.Log("трей Резонанса: выключен");
        }

        // ---------- the window ----------

        private static void Run()
        {
            try
            {
                _threadId = GetCurrentThreadId();
                _proc = Proc;
                var wc = new WNDCLASSEX
                {
                    cbSize = Marshal.SizeOf(typeof(WNDCLASSEX)),
                    lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
                    hInstance = GetModuleHandle(null),
                    lpszClassName = "Shell_TrayWnd",
                };
                if (RegisterClassEx(ref wc) == 0) { Program.Log("трей: класс окна не зарегистрировался (" + Marshal.GetLastWin32Error() + ")"); _on = false; return; }
                _explorer = FindExplorerTray();
                _hwnd = CreateWindowEx(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE, "Shell_TrayWnd", "", WS_POPUP, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
                if (_hwnd == IntPtr.Zero) { Program.Log("трей: окно не создалось (" + Marshal.GetLastWin32Error() + ")"); _on = false; return; }
                Raise();
                // FindWindow takes the topmost "Shell_TrayWnd": keep ours above Explorer's
                _keepTop = new Timer(_ => { Raise(); Prune(); SendNow(); }, null, 2000, 2000);
                Program.Log("трей Резонанса: включён" + (_explorer == IntPtr.Zero ? " (трей Windows не найден)" : ""));
                // every program: put your icon up again — now it comes here too
                PostMessage(HWND_BROADCAST, RegisterWindowMessage("TaskbarCreated"), IntPtr.Zero, IntPtr.Zero);

                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                {
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                }
            }
            catch (Exception e) { Program.Log("трей: " + e.Message); }
            finally
            {
                if (_hwnd != IntPtr.Zero) { try { DestroyWindow(_hwnd); } catch { } }
                _hwnd = IntPtr.Zero;
                try { UnregisterClass("Shell_TrayWnd", GetModuleHandle(null)); } catch { }
                _on = false;
            }
        }

        private static void Raise()
        {
            var h = _hwnd;
            if (h != IntPtr.Zero) SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        private static readonly uint MyPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;

        // Explorer's own taskbar window: the "Shell_TrayWnd" that isn't ours (with
        // ours above it, FindWindow alone would find ours)
        internal static IntPtr FindExplorerTray()
        {
            var all = ExplorerWindows("Shell_TrayWnd");
            return all.Count > 0 ? all[0] : IntPtr.Zero;
        }

        // Explorer's taskbars: the main one and those on the other screens
        internal static List<IntPtr> ExplorerTaskbars()
        {
            var list = ExplorerWindows("Shell_TrayWnd");
            list.AddRange(ExplorerWindows("Shell_SecondaryTrayWnd"));
            return list;
        }

        private static List<IntPtr> ExplorerWindows(string cls)
        {
            var list = new List<IntPtr>();
            IntPtr h = IntPtr.Zero;
            while ((h = FindWindowEx(IntPtr.Zero, h, cls, null)) != IntPtr.Zero)
            {
                GetWindowThreadProcessId(h, out uint pid);
                if (pid != MyPid) list.Add(h);
            }
            return list;
        }

        private static IntPtr Explorer()
        {
            if (_explorer == IntPtr.Zero || !IsWindow(_explorer)) _explorer = FindExplorerTray();
            return _explorer;
        }

        private static IntPtr Proc(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg == WM_COPYDATA)
            {
                int nim = -1;
                try
                {
                    var cds = (COPYDATASTRUCT)Marshal.PtrToStructure(lParam, typeof(COPYDATASTRUCT));
                    if (cds.dwData.ToInt64() == 1) nim = Read(cds.lpData, cds.cbData);
                }
                catch { }
                var res = Forward(msg, wParam, lParam, new IntPtr(1));
                // A program putting its icon up again (we asked all of them to): Explorer
                // still has it and says "no". Many programs then skip what comes next —
                // telling which way they want their clicks (NIM_SETVERSION) — so we'd
                // send them the wrong kind. The icon is there: say "yes".
                if (nim == NIM_ADD && res == IntPtr.Zero) res = new IntPtr(1);
                return res;
            }
            if (msg == WM_CLOSE && !_on)
            {
                DestroyWindow(h);
                return IntPtr.Zero;
            }
            if (msg == WM_DESTROY)
            {
                PostQuitMessage(0);
                return IntPtr.Zero;
            }
            // what programs ask the taskbar itself (its commands, WM_USER and up): Explorer answers
            if (msg == WM_COMMAND || (msg >= WM_USER && msg < 0xC000)) return Forward(msg, wParam, lParam, IntPtr.Zero);
            return DefWindowProc(h, msg, wParam, lParam);
        }

        private static IntPtr Forward(uint msg, IntPtr wParam, IntPtr lParam, IntPtr fallback)
        {
            var ex = Explorer();
            if (ex == IntPtr.Zero) return fallback;
            return SendMessageTimeout(ex, msg, wParam, lParam, SMTO_ABORTIFHUNG, 3000, out var res) != IntPtr.Zero ? res : fallback;
        }

        // ---------- the icons ----------

        private const int NIM_ADD = 0, NIM_MODIFY = 1, NIM_DELETE = 2, NIM_SETVERSION = 4;
        private const uint NIF_MESSAGE = 0x1, NIF_ICON = 0x2, NIF_TIP = 0x4, NIF_STATE = 0x8, NIF_GUID = 0x20, NIF_SHOWTIP = 0x80;
        private const uint NIS_HIDDEN = 0x1;

        // SHELLTRAYDATA: a signature, the NIM_ message, then NOTIFYICONDATAW with
        // 32-bit handles (the same for 32- and 64-bit programs)
        private static int Read(IntPtr p, int len)
        {
            if (len < 8 + 24 || Marshal.ReadInt32(p, 0) != 0x34753423) return -1;
            int nim = Marshal.ReadInt32(p, 4);
            var d = p + 8;
            int n = len - 8;
            var hwnd = new IntPtr((long)(uint)Marshal.ReadInt32(d, 4));
            uint uid = (uint)Marshal.ReadInt32(d, 8);
            uint flags = (uint)Marshal.ReadInt32(d, 12);
            string guid = null;
            if ((flags & NIF_GUID) != 0 && n >= 952)
            {
                var g = new byte[16];
                Marshal.Copy(d + 936, g, 0, 16);
                guid = new Guid(g).ToString();
            }
            string id = guid ?? (hwnd.ToInt64() + ":" + uid);

            lock (Lock)
            {
                if (nim == NIM_DELETE)
                {
                    Icons.Remove(id);
                }
                else if (nim == NIM_ADD || nim == NIM_MODIFY || nim == NIM_SETVERSION)
                {
                    if (!Icons.TryGetValue(id, out var ic))
                    {
                        if (nim != NIM_ADD && guid == null) return nim;
                        ic = new Icon { Id = id, Order = ++_order };
                        Icons[id] = ic;
                        Program.Log("трей: новый значок " + id + " (" + (nim == NIM_ADD ? "add" : "nim " + nim) + ", флаги 0x" + flags.ToString("x") + ", размер " + n + ")");
                    }
                    if (hwnd != IntPtr.Zero) ic.Hwnd = hwnd;
                    ic.Uid = uid;
                    if (nim == NIM_SETVERSION) { if (n >= 804) ic.Version = (uint)Marshal.ReadInt32(d, 800); }
                    else if (nim == NIM_ADD && (flags & NIF_SHOWTIP) != 0 && ic.Version == 0) ic.Version = 4; // NIF_SHOWTIP exists only for version 4
                    else
                    {
                        if ((flags & NIF_MESSAGE) != 0) ic.Callback = (uint)Marshal.ReadInt32(d, 16);
                        if ((flags & NIF_ICON) != 0) ic.HIcon = new IntPtr((long)(uint)Marshal.ReadInt32(d, 20));
                        if ((flags & NIF_TIP) != 0 && n >= 280) ic.Tip = Marshal.PtrToStringUni(d + 24, 128).Split('\0')[0];
                        if ((flags & NIF_STATE) != 0 && n >= 288)
                        {
                            uint state = (uint)Marshal.ReadInt32(d, 280), mask = (uint)Marshal.ReadInt32(d, 284);
                            if ((mask & NIS_HIDDEN) != 0) ic.Hidden = (state & NIS_HIDDEN) != 0;
                        }
                    }
                }
                else return nim;
            }
            SendSoon();
            return nim;
        }

        // dead programs leave their icons behind: drop those whose window is gone
        private static void Prune()
        {
            bool gone = false;
            lock (Lock)
            {
                var dead = new List<string>();
                foreach (var ic in Icons.Values) if (ic.Hwnd == IntPtr.Zero || !IsWindow(ic.Hwnd)) dead.Add(ic.Id);
                foreach (var k in dead) Icons.Remove(k);
                gone = dead.Count > 0;
            }
            if (gone) SendSoon();
        }

        private static void SendSoon()
        {
            lock (Lock)
            {
                if (_sendTimer == null) _sendTimer = new Timer(_ => SendNow(), null, 150, Timeout.Infinite);
                else _sendTimer.Change(150, Timeout.Infinite);
            }
        }

        internal static void SendNow()
        {
            var list = new List<Dictionary<string, object>>();
            var sig = new StringBuilder();
            List<Icon> icons;
            lock (Lock)
            {
                icons = new List<Icon>(Icons.Values);
            }
            icons.Sort((a, b) => a.Order.CompareTo(b.Order));
            foreach (var ic in icons)
            {
                if (ic.Pid == 0 && ic.Hwnd != IntPtr.Zero)
                {
                    GetWindowThreadProcessId(ic.Hwnd, out ic.Pid);
                    ic.Exe = ExeOf(ic.Pid);
                }
                if (ic.Hidden)
                {
                    bool first;
                    lock (Lock) first = FailedOnce.Add("skip|" + ic.Id);
                    if (first) Program.Log("трей: не показываю " + Path.GetFileName(ic.Exe) + " (" + ic.Id + ", скрыт программой)");
                    continue;
                }
                // no picture of its own (or it didn't come out): the program's own icon
                var png = ic.HIcon != IntPtr.Zero ? PngFor(ic) : "";
                if (png.Length == 0 && ic.Exe.Length > 0)
                {
                    var k = "exe|" + ic.Exe;
                    lock (Lock) Pngs.TryGetValue(k, out png);
                    if (string.IsNullOrEmpty(png))
                    {
                        try { png = Apps.IconOf(ic.Exe); } catch { png = ""; }
                        if (png.Length > 0) lock (Lock) Pngs[k] = png;
                    }
                }
                png = png ?? "";
                if (png.Length == 0) continue;
                list.Add(new Dictionary<string, object> { { "id", ic.Id }, { "tip", ic.Tip }, { "icon", png }, { "exe", Path.GetFileName(ic.Exe) } });
                sig.Append(ic.Id).Append(ic.HIcon.ToInt64()).Append(ic.Tip).Append(png.Length).Append('|');
            }
            var s = sig.ToString();
            if (s == _lastSig) return;
            _lastSig = s;
            Program.Send(new Dictionary<string, object> { { "type", "tray" }, { "list", list } });
        }

        internal static void Resend()
        {
            _lastSig = "";
            SendNow();
        }

        private static string PngFor(Icon ic)
        {
            string key = ic.Id + "|" + ic.HIcon.ToInt64();
            lock (Lock) { if (Pngs.TryGetValue(key, out var cached)) return cached; }
            string png = "";
            try
            {
                using (var icon = System.Drawing.Icon.FromHandle(ic.HIcon))
                using (var bmp = icon.ToBitmap())
                using (var ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    png = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
            catch (Exception e)
            {
                bool first;
                lock (Lock) first = FailedOnce.Add(key);
                if (first) Program.Log("трей: картинка " + Path.GetFileName(ic.Exe) + " не прочиталась: " + e.Message);
            }
            // a picture that didn't come out is tried again next time
            if (png.Length == 0) return png;
            lock (Lock)
            {
                if (Pngs.Count > 200) Pngs.Clear();
                Pngs[key] = png;
            }
            return png;
        }

        private static string ExeOf(uint pid)
        {
            try { return System.Diagnostics.Process.GetProcessById((int)pid).MainModule.FileName; } catch { return ""; }
        }

        // ---------- a click on an icon in Резонанс's taskbar ----------

        private const uint WM_LBUTTONDOWN = 0x201, WM_LBUTTONUP = 0x202, WM_LBUTTONDBLCLK = 0x203;
        private const uint WM_RBUTTONDOWN = 0x204, WM_RBUTTONUP = 0x205, WM_CONTEXTMENU = 0x7B;
        private const uint NIN_SELECT = WM_USER, NIN_KEYSELECT = WM_USER + 1;

        internal static void Click(string id, string button)
        {
            Icon ic;
            lock (Lock) { if (!Icons.TryGetValue(id, out ic)) return; }
            // Windows Security never tells its click message again after it put its
            // icon up (it only updates it): open the app itself, as its click would
            if (ic.Callback == 0 && Path.GetFileName(ic.Exe).Equals("SecurityHealthSystray.exe", StringComparison.OrdinalIgnoreCase))
            {
                Program.Log("трей: клик " + button + " → Безопасность Windows");
                Apps.Launch("windowsdefender:", "");
                return;
            }
            if (ic.Callback == 0 || !IsWindow(ic.Hwnd))
            {
                Program.Log("трей: клик " + button + " — значок без окна (" + ic.Exe + ", id " + ic.Id + ", окно " + ic.Hwnd.ToInt64() + (IsWindow(ic.Hwnd) ? "" : " нет") + ", сообщение " + ic.Callback + ")");
                return;
            }
            GetCursorPos(out var pt);
            if (ic.Pid == 0) GetWindowThreadProcessId(ic.Hwnd, out ic.Pid);
            // The program brings its menu or window to the front. Windows lets it only
            // if the process that got the last input says so — after a click on
            // Explorer's tray that is Explorer. Here it is Резонанс's window, so the
            // helper presses a key Windows does nothing with (now the last input is
            // the helper's) and then lets the program.
            ShellNative.keybd_event(ShellNative.VK_MASK, 0, 0, Hooks.Mine);
            ShellNative.keybd_event(ShellNative.VK_MASK, 0, ShellNative.KEYEVENTF_KEYUP, Hooks.Mine);
            Thread.Sleep(30);
            bool allowed = ic.Pid != 0 && AllowSetForegroundWindow(ic.Pid);
            Program.Log("трей: клик " + button + " → " + Path.GetFileName(ic.Exe) + " (версия " + ic.Version + (allowed ? ", программе можно вперёд" : ", программе нельзя вперёд: " + Marshal.GetLastWin32Error()) + ")");
            uint[] seq = button == "right" ? new[] { WM_RBUTTONDOWN, WM_RBUTTONUP }
                : button == "double" ? new[] { WM_LBUTTONDBLCLK, WM_LBUTTONUP }
                : new[] { WM_LBUTTONDOWN, WM_LBUTTONUP };
            foreach (var m in seq) Notify(ic, m, pt);
            if (ic.Version >= 4) Notify(ic, button == "right" ? WM_CONTEXTMENU : NIN_SELECT, pt);
        }

        private static void Notify(Icon ic, uint m, POINT pt)
        {
            if (ic.Version >= 4)
                PostMessage(ic.Hwnd, ic.Callback, new IntPtr((pt.Y << 16) | (pt.X & 0xFFFF)), new IntPtr(((int)ic.Uid << 16) | (int)(m & 0xFFFF)));
            else
                PostMessage(ic.Hwnd, ic.Callback, new IntPtr(ic.Uid), new IntPtr(m));
        }

        // ---------- native ----------

        private delegate IntPtr WndProc(IntPtr h, uint msg, IntPtr wParam, IntPtr lParam);

        private const uint WM_DESTROY = 0x2, WM_CLOSE = 0x10, WM_COPYDATA = 0x4A, WM_COMMAND = 0x111, WM_USER = 0x400;
        private const uint WS_POPUP = 0x80000000;
        private const uint WS_EX_TOOLWINDOW = 0x80, WS_EX_TOPMOST = 0x8, WS_EX_NOACTIVATE = 0x08000000;
        private const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;
        private const uint WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20, LWA_ALPHA = 0x2;
        private const int SW_HIDE = 0;
        private const uint SMTO_ABORTIFHUNG = 0x2;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_BROADCAST = new IntPtr(0xFFFF);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WNDCLASSEX
        {
            public int cbSize;
            public uint style;
            public IntPtr lpfnWndProc;
            public int cbClsExtra, cbWndExtra;
            public IntPtr hInstance, hIcon, hCursor, hbrBackground;
            public string lpszMenuName, lpszClassName;
            public IntPtr hIconSm;
        }

        [StructLayout(LayoutKind.Sequential)] private struct COPYDATASTRUCT { public IntPtr dwData; public int cbData; public IntPtr lpData; }
        [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool UnregisterClass(string cls, IntPtr inst);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
        [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] private static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
        [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG m);
        [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG m);
        [DllImport("user32.dll")] private static extern void PostQuitMessage(int code);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string s);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
        [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll", SetLastError = true)] private static extern bool AllowSetForegroundWindow(uint pid);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] private static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    }
}
