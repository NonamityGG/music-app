// Резонанс для ПК — the Win key opens Резонанс's own Start menu and Quick
// settings instead of Windows'. One low-level keyboard hook on a thread of its
// own (the hook needs a message loop). Only the bare Win key (→ Пуск) and Win+A
// (→ быстрые настройки) are taken; every other shortcut (Win+E, Win+R, Win+D…)
// passes straight through, and nothing else — no mouse, no other keys — is
// watched. The hook is live only while the app runs and is dropped on exit.

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
        private static ShellNative.HookProc _kbProc; // kept alive against the GC
        private static volatile bool _on;

        private static bool _winDown;
        private static bool _combo;
        private static long _lastEmit;

        internal static void Install()
        {
            if (_on) return;
            _on = true;
            _thread = new Thread(Run) { IsBackground = true, Name = "hooks" };
            _thread.Start();
            Program.Log("перехват: Win → Пуск, Win+A → быстрые настройки");
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
            _kb = ShellNative.SetWindowsHookEx(ShellNative.WH_KEYBOARD_LL, _kbProc, mod, 0);
            if (_kb == IntPtr.Zero) Program.Log("перехват Win не встал");
            ShellNative.MSG msg;
            while (_on && ShellNative.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
            if (_kb != IntPtr.Zero) ShellNative.UnhookWindowsHookEx(_kb);
            _kb = IntPtr.Zero;
        }

        private static void Emit(string key)
        {
            var now = DateTime.UtcNow.Ticks / 10000;
            if (now - _lastEmit < 200) return; // one open per press
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
    }
}
