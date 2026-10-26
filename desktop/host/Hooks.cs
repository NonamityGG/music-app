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

        // what the hook takes: the Win key (Start, Win+A) and the volume keys (the pill)
        internal static volatile bool Keys = true;
        internal static volatile bool Osd;
        internal static volatile bool AltTab;

        private static bool _switching; // Alt+Tab: the switcher is up
        private static bool _maskAlt; // Alt's release must not reach Windows bare
        private static bool _eatEscUp;
        private const int VK_TAB = 0x09, VK_ESCAPE = 0x1B, VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28;

        private static bool _winDown;
        private static bool _combo;
        private static bool _ate; // a key of a Win combo was taken (Win+A)
        private static long _lastEmit;

        private const int VK_VOLUME_MUTE = 0xAD;
        private const int VK_VOLUME_DOWN = 0xAE;
        private const int VK_VOLUME_UP = 0xAF;

        // marks the keys this hook sends itself, so it lets them through
        internal static readonly UIntPtr Mine = new UIntPtr(0x52455A4E); // "REZN"

        internal static void Install()
        {
            var what = new List<string>();
            if (Keys) what.Add("Win → Пуск, Win+A → быстрые настройки");
            if (Osd) what.Add("клавиши громкости → громкость Резонанса");
            if (AltTab) what.Add("Alt+Tab → переключатель Резонанса");
            Program.Log("перехват: " + string.Join("; ", what));
            if (_on) return;
            _on = true;
            _thread = new Thread(Run) { IsBackground = true, Name = "hooks" };
            _thread.Start();
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

        // the switcher's steps: every one counts, so no "one per press" here
        private static void Switch(string key, int dir)
        {
            Program.Send(new Dictionary<string, object> { { "type", "hotkey" }, { "key", key }, { "dir", dir } });
        }

        private static bool Down(int msg) { return msg == ShellNative.WM_KEYDOWN || msg == ShellNative.WM_SYSKEYDOWN; }
        private static bool Up(int msg) { return msg == ShellNative.WM_KEYUP || msg == ShellNative.WM_SYSKEYUP; }

        private static IntPtr KbProc(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code == ShellNative.HC_ACTION)
            {
                var info = (ShellNative.KBDLLHOOK)Marshal.PtrToStructure(lParam, typeof(ShellNative.KBDLLHOOK));
                if (info.dwExtraInfo.ToInt64() == (long)Mine.ToUInt64())
                    return ShellNative.CallNextHookEx(_kb, code, wParam, lParam);
                int m = wParam.ToInt32();
                int vk = (int)info.vkCode;
                // the volume keys: Резонанс changes the volume and shows its pill;
                // Windows gets neither the press nor the release (so no flyout of its own)
                if (Osd && (vk == VK_VOLUME_MUTE || vk == VK_VOLUME_DOWN || vk == VK_VOLUME_UP))
                {
                    if (Down(m)) ThreadPool.QueueUserWorkItem(_ => Status.VolumeKey(vk));
                    return new IntPtr(1);
                }
                // Alt+Tab: Резонанс's own window switcher. While Alt is held, Tab (Shift+Tab,
                // the arrows) step through the windows, Esc cancels; letting go of Alt
                // picks the window. Ctrl+Alt+Tab is left to Windows.
                if (AltTab)
                {
                    bool altKey = vk == 0x12 || vk == 0xA4 || vk == 0xA5;
                    if (vk == VK_TAB && Down(m) && (info.flags & 0x20) != 0 /* LLKHF_ALTDOWN */ && (ShellNative.GetAsyncKeyState(0x11) & 0x8000) == 0)
                    {
                        bool shift = (ShellNative.GetAsyncKeyState(0x10) & 0x8000) != 0;
                        Switch(_switching ? "switchStep" : "switchStart", shift ? -1 : 1);
                        _switching = true;
                        _maskAlt = true;
                        return new IntPtr(1);
                    }
                    if (_switching)
                    {
                        if (vk == VK_TAB) return new IntPtr(1); // its release
                        if (Down(m) && (vk == VK_LEFT || vk == VK_RIGHT || vk == VK_UP || vk == VK_DOWN))
                        {
                            Switch("switchStep", vk == VK_LEFT || vk == VK_UP ? -1 : 1);
                            return new IntPtr(1);
                        }
                        if (vk == VK_ESCAPE && Down(m))
                        {
                            _switching = false;
                            _eatEscUp = true;
                            Switch("switchCancel", 0);
                            return new IntPtr(1);
                        }
                    }
                    if (_eatEscUp && vk == VK_ESCAPE && Up(m)) { _eatEscUp = false; return new IntPtr(1); }
                    // Alt goes up: the window is picked. As with Win, Windows saw Alt go
                    // down with nothing after it: alone, its up would open the menu bar
                    // of the app in front — a key Windows ignores comes first.
                    if (altKey && Up(m) && _maskAlt)
                    {
                        if (_switching) Switch("switchDone", 0);
                        _switching = false;
                        _maskAlt = false;
                        Release((byte)vk, (info.flags & 0x1) != 0);
                        return new IntPtr(1);
                    }
                }
                if (!Keys) return ShellNative.CallNextHookEx(_kb, code, wParam, lParam);
                bool win =vk == ShellNative.VK_LWIN || vk == ShellNative.VK_RWIN;
                if (Down(m))
                {
                    if (win)
                    {
                        if (!_winDown) { _winDown = true; _combo = false; _ate = false; }
                        // the Win down passes, so Win+E, Win+R and the rest still work
                    }
                    else if (_winDown)
                    {
                        _combo = true;
                        bool ctrl = (ShellNative.GetAsyncKeyState(0x11) & 0x8000) != 0;
                        bool shift = (ShellNative.GetAsyncKeyState(0x10) & 0x8000) != 0;
                        if (vk == ShellNative.VK_A && !ctrl && !shift)
                        {
                            _ate = true;
                            Emit("quick"); // Win+A: our Quick settings, not Windows'
                            return new IntPtr(1);
                        }
                    }
                }
                else if (Up(m) && win)
                {
                    bool lone = _winDown && !_combo;
                    bool ate = _ate;
                    _winDown = false;
                    _ate = false;
                    if (lone || ate)
                    {
                        if (lone) Emit("start"); // the bare Win key: our Start, not Windows'
                        // Windows already saw the Win key go down. Its up can't just be
                        // swallowed: Windows would think Win is still held, and every key
                        // after it would be a Win shortcut (E opens Explorer, L locks…).
                        // So: a key Windows ignores first (now it's a "combo", Windows'
                        // Start stays shut), then the Win up itself — both sent from here.
                        Release((byte)vk, (info.flags & 0x1) != 0);
                        return new IntPtr(1);
                    }
                }
            }
            return ShellNative.CallNextHookEx(_kb, code, wParam, lParam);
        }

        private static void Release(byte winVk, bool extended)
        {
            uint ext = extended ? ShellNative.KEYEVENTF_EXTENDEDKEY : 0;
            ShellNative.keybd_event(ShellNative.VK_MASK, 0, 0, Mine);
            ShellNative.keybd_event(ShellNative.VK_MASK, 0, ShellNative.KEYEVENTF_KEYUP, Mine);
            ShellNative.keybd_event(winVk, 0, ext | ShellNative.KEYEVENTF_KEYUP, Mine);
        }
    }
}
