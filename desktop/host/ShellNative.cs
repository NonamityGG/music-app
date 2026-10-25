// Резонанс для ПК — the Windows calls the shell side needs (hooks, the system
// font, launching apps, volume, the battery). Kept apart from the rest so the
// main file stays readable.

using System;
using System.Runtime.InteropServices;

namespace Rezonans
{
    internal static class ShellNative
    {
        internal static readonly IntPtr HWND_BROADCAST = new IntPtr(0xFFFF);
        internal const uint WM_FONTCHANGE = 0x001D;
        internal const uint WM_SETTINGCHANGE = 0x001A;

        internal const uint SPI_GETNONCLIENTMETRICS = 0x0029;
        internal const uint SPI_SETNONCLIENTMETRICS = 0x002A;
        internal const uint SPI_GETICONTITLELOGFONT = 0x001F;
        internal const uint SPI_SETICONTITLELOGFONT = 0x0022;
        internal const uint SPIF_SENDCHANGE = 0x02;

        internal const int WH_KEYBOARD_LL = 13;
        internal const int WH_MOUSE_LL = 14;
        internal const int HC_ACTION = 0;
        internal const int WM_KEYDOWN = 0x0100;
        internal const int WM_KEYUP = 0x0101;
        internal const int WM_SYSKEYDOWN = 0x0104;
        internal const int WM_SYSKEYUP = 0x0105;
        internal const int WM_LBUTTONDOWN = 0x0201;
        internal const int WM_RBUTTONDOWN = 0x0204;
        internal const int VK_LWIN = 0x5B;
        internal const int VK_RWIN = 0x5C;
        internal const int VK_A = 0x41;

        internal delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        internal struct KBDLLHOOK { public uint vkCode, scanCode, flags, time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        internal struct MSLLHOOK { public POINT pt; public uint mouseData, flags, time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        internal struct POINT { public int X, Y; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct LOGFONT
        {
            public int lfHeight, lfWidth, lfEscapement, lfOrientation, lfWeight;
            public byte lfItalic, lfUnderline, lfStrikeOut, lfCharSet, lfOutPrecision, lfClipPrecision, lfQuality, lfPitchAndFamily;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string lfFaceName;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct NONCLIENTMETRICS
        {
            public int cbSize;
            public int iBorderWidth, iScrollWidth, iScrollHeight, iCaptionWidth, iCaptionHeight;
            public LOGFONT lfCaptionFont;
            public int iSmCaptionWidth, iSmCaptionHeight;
            public LOGFONT lfSmCaptionFont;
            public int iMenuWidth, iMenuHeight;
            public LOGFONT lfMenuFont;
            public LOGFONT lfStatusFont;
            public LOGFONT lfMessageFont;
            public int iPaddedBorderWidth;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct POWERSTATUS
        {
            public byte ACLineStatus;
            public byte BatteryFlag;
            public byte BatteryLifePercent;
            public byte SystemStatusFlag;
            public int BatteryLifeTime;
            public int BatteryFullLifeTime;
        }

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW")] internal static extern bool SystemParametersInfoNCM(uint action, int param, ref NONCLIENTMETRICS pv, uint winIni);
        [DllImport("user32.dll", SetLastError = true, EntryPoint = "SystemParametersInfoW")] internal static extern bool SystemParametersInfoLF(uint action, int param, ref LOGFONT pv, uint winIni);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] internal static extern int AddFontResource(string file);
        [DllImport("user32.dll")] internal static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);

        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetWindowsHookEx(int idHook, HookProc cb, IntPtr hMod, uint thread);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool UnhookWindowsHookEx(IntPtr h);
        [DllImport("user32.dll")] internal static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int vk);

        [StructLayout(LayoutKind.Sequential)]
        internal struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
        [DllImport("user32.dll")] internal static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
        [DllImport("user32.dll")] internal static extern bool PostThreadMessage(uint thread, uint msg, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
        internal const uint WM_QUIT = 0x0012;

        [DllImport("kernel32.dll")] internal static extern bool GetSystemPowerStatus(out POWERSTATUS s);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr ShellExecute(IntPtr h, string op, string file, string param, string dir, int show);

        // the shell icon of a file (handles .lnk → the target's icon)
        internal const uint SHGFI_ICON = 0x000000100;
        internal const uint SHGFI_LARGEICON = 0x000000000;
        internal const uint SHGFI_SMALLICON = 0x000000001;
        internal const uint SHGFI_USEFILEATTRIBUTES = 0x000000010;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct SHFILEINFO
        {
            public IntPtr hIcon;
            public int iIcon;
            public uint dwAttributes;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr SHGetFileInfo(string path, uint attrs, ref SHFILEINFO info, uint cb, uint flags);
        [DllImport("user32.dll")] internal static extern bool DestroyIcon(IntPtr h);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr FindWindow(string cls, string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr h, out RECT r);
        [StructLayout(LayoutKind.Sequential)] internal struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")] internal static extern bool LockWorkStation();
        [DllImport("powrprof.dll", SetLastError = true)] internal static extern bool SetSuspendState(bool hibernate, bool force, bool wakeupEventsDisabled);
    }
}
