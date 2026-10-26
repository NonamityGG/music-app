// Резонанс для ПК — who is really under a point of the screen.
//
// For the bar's logo: when it stops taking clicks (after a screenshot, after a
// reboot) this says which window sits on top of it, and whether the bar itself
// lost its "always on top", started letting clicks through or got hidden by the
// system — so the app can put it right and the log can say what happened.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Rezonans
{
    internal static class Probe
    {
        [StructLayout(LayoutKind.Sequential)] private struct PT { public int X, Y; }

        [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(PT p);
        [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr h, uint flags);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
        [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);

        internal static void At(IntPtr mine, int x, int y)
        {
            var hit = WindowFromPoint(new PT { X = x, Y = y });
            var root = hit == IntPtr.Zero ? IntPtr.Zero : GetAncestor(hit, 2 /* GA_ROOT */);
            long ex = mine == IntPtr.Zero ? 0 : GetWindowLongPtr(mine, -20 /* GWL_EXSTYLE */).ToInt64();
            int cloaked = 0;
            if (mine != IntPtr.Zero) DwmGetWindowAttribute(mine, 14 /* DWMWA_CLOAKED */, out cloaked, 4);
            bool own = false;
            try { own = root != IntPtr.Zero && Foreground.Own.Contains(root.ToInt64()); } catch { }
            Program.Send(new Dictionary<string, object>
            {
                { "type", "probe" },
                { "mine", root != IntPtr.Zero && root == mine },
                { "own", own },
                { "cls", ClassOf(root) },
                { "exe", ExeOf(root) },
                { "visible", mine != IntPtr.Zero && IsWindowVisible(mine) },
                { "topmost", (ex & 0x8) != 0 },      // WS_EX_TOPMOST
                { "transparent", (ex & 0x20) != 0 }, // WS_EX_TRANSPARENT
                { "cloaked", cloaked != 0 },
            });
        }

        // a window to the very back, below everything (and no longer "always on
        // top"): the bar steps aside for a full-screen window without being hidden
        internal static void ToBack(IntPtr h)
        {
            if (h == IntPtr.Zero || !Native.IsWindow(h)) return;
            Native.SetWindowPos(h, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
        }

        private static string ClassOf(IntPtr h)
        {
            if (h == IntPtr.Zero) return "";
            var sb = new StringBuilder(256);
            GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static string ExeOf(IntPtr h)
        {
            if (h == IntPtr.Zero) return "";
            try
            {
                GetWindowThreadProcessId(h, out uint pid);
                using (var p = System.Diagnostics.Process.GetProcessById((int)pid)) return p.ProcessName;
            }
            catch { return "?"; }
        }
    }
}
