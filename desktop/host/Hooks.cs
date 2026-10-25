// Резонанс для ПК — the Win key, the Start button and the tray open Резонанс's
// own Start menu and Quick settings instead of Windows'. Done with low-level
// keyboard and mouse hooks on a thread of their own (these hooks need a message
// loop). Only the bare Win key, Win+A, the Start button and the tray cluster are
// taken; every other shortcut (Win+E, Win+R…) passes straight through.

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace Rezonans
{
    internal static class Hooks
    {
        private static Thread _thread;
        private static uint _threadId;
        private static IntPtr _kb = IntPtr.Zero;
        private static IntPtr _mouse = IntPtr.Zero;
        private static ShellNative.HookProc _kbProc; // kept alive against the GC
        private static ShellNative.HookProc _mouseProc;
        private static volatile bool _on;

        private static bool _winDown;
        private static bool _combo;
        private static long _lastEmit;
        private static bool _startBtn; // the taskbar's Start button could be located

        internal static void Install()
        {
            if (_on) return;
            _on = true;
            _thread = new Thread(Run) { IsBackground = true, Name = "hooks" };
            _thread.Start();
            Program.Log("перехват: Win, Пуск и трей — Резонанс");
        }

        internal static void Remove()
        {
            if (!_on) return;
            _on = false;
            try { if (_threadId != 0) ShellNative.PostThreadMessage(_threadId, ShellNative.WM_QUIT, IntPtr.Zero, IntPtr.Zero); } catch { }
        }

        private static void Run()
        {
            _threadId = ShellNative.GetCurrentThreadId();
            var mod = ShellNative.GetModuleHandle(null);
            _kbProc = KbProc;
            _mouseProc = MouseProc;
            _kb = ShellNative.SetWindowsHookEx(ShellNative.WH_KEYBOARD_LL, _kbProc, mod, 0);
            _mouse = ShellNative.SetWindowsHookEx(ShellNative.WH_MOUSE_LL, _mouseProc, mod, 0);
            if (_kb == IntPtr.Zero) Program.Log("перехват клавиш не встал");
            ShellNative.MSG msg;
            while (_on && ShellNative.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
            if (_kb != IntPtr.Zero) ShellNative.UnhookWindowsHookEx(_kb);
            if (_mouse != IntPtr.Zero) ShellNative.UnhookWindowsHookEx(_mouse);
            _kb = _mouse = IntPtr.Zero;
        }

        private static void Emit(string key)
        {
            var now = DateTime.UtcNow.Ticks / 10000;
            if (now - _lastEmit < 200) return; // one open per click/press
            _lastEmit = now;
            Program.Send(new Dictionary<string, object> { { "type", "hotkey" }, { "key", key } });
        }

        private static bool Down(int msg) { return msg == ShellNative.WM_KEYDOWN || msg == ShellNative.WM_SYSKEYDOWN; }
        private static bool Up(int msg) { return msg == ShellNative.WM_KEYUP || msg == ShellNative.WM_SYSKEYUP; }

        private static IntPtr KbProc(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code == ShellNative.HC_ACTION)
            {
                var info = (ShellNative.KBDLLHOOK)Marshal.PtrToStructure(lParam, typeof(ShellNative.KBDLLHOOK));
                int m = wParam.ToInt32();
                int vk = (int)info.vkCode;
                bool win = vk == ShellNative.VK_LWIN || vk == ShellNative.VK_RWIN;
                if (Down(m))
                {
                    if (win)
                    {
                        if (!_winDown) { _winDown = true; _combo = false; }
                        // the Win down passes, so Win+E, Win+R and the rest still work
                    }
                    else if (_winDown)
                    {
                        _combo = true;
                        bool ctrl = (ShellNative.GetAsyncKeyState(0x11) & 0x8000) != 0;
                        bool shift = (ShellNative.GetAsyncKeyState(0x10) & 0x8000) != 0;
                        if (vk == ShellNative.VK_A && !ctrl && !shift)
                        {
                            Emit("quick"); // Win+A: our Quick settings, not Windows'
                            return new IntPtr(1);
                        }
                    }
                }
                else if (Up(m) && win)
                {
                    bool lone = _winDown && !_combo;
                    _winDown = false;
                    if (lone)
                    {
                        Emit("start"); // the bare Win key: our Start, not Windows'
                        return new IntPtr(1); // swallow the up so Windows' Start stays shut
                    }
                }
            }
            return ShellNative.CallNextHookEx(_kb, code, wParam, lParam);
        }

        private static IntPtr MouseProc(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code == ShellNative.HC_ACTION && wParam.ToInt32() == ShellNative.WM_LBUTTONDOWN)
            {
                try
                {
                    var info = (ShellNative.MSLLHOOK)Marshal.PtrToStructure(lParam, typeof(ShellNative.MSLLHOOK));
                    int x = info.pt.X, y = info.pt.Y;
                    var tray = ShellNative.FindWindow("Shell_TrayWnd", null);
                    if (tray != IntPtr.Zero)
                    {
                        // the Start button, when it is a window we can find
                        var start = ShellNative.FindWindowEx(tray, IntPtr.Zero, "Start", null);
                        if (start != IntPtr.Zero && ShellNative.GetWindowRect(start, out var sr) && In(sr, x, y))
                        {
                            Emit("start");
                            return new IntPtr(1);
                        }
                        // the clock / status cluster at the far end of the taskbar
                        var notify = ShellNative.FindWindowEx(tray, IntPtr.Zero, "TrayNotifyWnd", null);
                        if (notify != IntPtr.Zero && ShellNative.GetWindowRect(notify, out var nr) && In(nr, x, y))
                        {
                            Emit("quick");
                            return new IntPtr(1);
                        }
                    }
                }
                catch { }
            }
            return ShellNative.CallNextHookEx(_mouse, code, wParam, lParam);
        }

        private static bool In(ShellNative.RECT r, int x, int y)
        {
            return x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom;
        }
    }
}
