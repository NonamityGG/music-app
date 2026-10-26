// Резонанс для ПК — the panel-at-the-bottom's data: the list of open windows
// (icon, title, which is in front, which are minimised), bringing a window to
// the front or minimising it, and putting the Windows taskbar into auto-hide so
// Резонанс's own bar sits in its place (the real tray slides up on a hover at
// the very bottom). Pure window bookkeeping — nothing is injected anywhere.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Rezonans
{
    internal static class Taskbar
    {
        private static readonly Dictionary<string, string> IconCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static string _lastSig = "";

        internal static List<Dictionary<string, object>> Windows()
        {
            var fg = GetForegroundWindow();
            var list = new List<Dictionary<string, object>>();
            EnumWindows((h, l) =>
            {
                if (!Taskworthy(h)) return true;
                var title = TitleOf(h);
                if (string.IsNullOrWhiteSpace(title)) return true;
                var exe = ExeOf(h);
                list.Add(new Dictionary<string, object>
                {
                    { "hwnd", h.ToInt64().ToString() },
                    { "title", title },
                    { "icon", exe == null ? "" : Icon(exe) },
                    { "active", h == fg },
                    { "min", IsIconic(h) },
                });
                return true;
            }, IntPtr.Zero);
            return list;
        }

        // the list changed since last time? (so the bar is sent updates only on change)
        internal static string Signature(List<Dictionary<string, object>> list)
        {
            var sb = new StringBuilder();
            foreach (var w in list) sb.Append(w["hwnd"]).Append(w["active"]).Append(w["min"]).Append('|');
            return sb.ToString();
        }

        internal static bool Changed(List<Dictionary<string, object>> list)
        {
            var sig = Signature(list);
            if (sig == _lastSig) return false;
            _lastSig = sig;
            return true;
        }

        private static bool Taskworthy(IntPtr h)
        {
            if (!IsWindowVisible(h)) return false;
            if (Foreground.Own.Contains(h.ToInt64())) return false;
            long ex = GetWindowLongPtr(h, GWL_EXSTYLE).ToInt64();
            if ((ex & WS_EX_TOOLWINDOW) != 0) return false;
            // owned windows (dialogs) ride with their owner, unless they ask to appear
            if (GetWindow(h, GW_OWNER) != IntPtr.Zero && (ex & WS_EX_APPWINDOW) == 0) return false;
            // UWP / background XAML windows report themselves "cloaked"
            int cloaked = 0;
            if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0) return false;
            return true;
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

        private static string Icon(string exe)
        {
            if (IconCache.TryGetValue(exe, out var cached)) return cached;
            var png = Apps.IconOf(exe);
            if (IconCache.Count > 80) IconCache.Clear();
            IconCache[exe] = png;
            return png;
        }

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
            else ShowWindow(h, SW_SHOW);
            SetForegroundWindow(h);
        }

        // ---------- the Windows taskbar out of the way (reversible) ----------

        internal static void WindowsTaskbar(bool autohide)
        {
            try
            {
                var tray = FindWindow("Shell_TrayWnd", null);
                var abd = new APPBARDATA
                {
                    cbSize = Marshal.SizeOf(typeof(APPBARDATA)),
                    hWnd = tray,
                    lParam = new IntPtr(autohide ? ABS_AUTOHIDE : ABS_ALWAYSONTOP),
                };
                SHAppBarMessage(ABM_SETSTATE, ref abd);
                Program.Log("панель задач Windows: " + (autohide ? "автоскрытие" : "как было"));
            }
            catch (Exception e) { Program.Log("панель задач Windows: " + e.Message); }
        }

        // ---------- native ----------

        private const int GWL_EXSTYLE = -20;
        private const long WS_EX_TOOLWINDOW = 0x00000080;
        private const long WS_EX_APPWINDOW = 0x00040000;
        private const uint GW_OWNER = 4;
        private const int DWMWA_CLOAKED = 14;
        private const int SW_MINIMIZE = 6;
        private const int SW_RESTORE = 9;
        private const int SW_SHOW = 5;
        private const uint ABM_SETSTATE = 0x0000000A;
        private const int ABS_AUTOHIDE = 0x01;
        private const int ABS_ALWAYSONTOP = 0x02;

        private delegate bool EnumProc(IntPtr h, IntPtr l);

        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
        [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string name);
        [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
        [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(int access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr proc, int flags, StringBuilder name, ref int size);
        [DllImport("shell32.dll")] private static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);

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
