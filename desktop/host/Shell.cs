// Резонанс для ПК — the shell side of the helper: the system font for the whole
// of Windows, the Win key and the Start button and the tray opening Резонанс's
// own Start menu and Quick settings instead of Windows', the list of apps and
// their icons, volume, the radios and the battery, and the power actions.
//
// Everything here is reversible: the fonts are backed up before they change and
// put back on restore or uninstall, and the hooks are only live while the app
// runs.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace Rezonans
{
    // ---------------------------------------------------------------------------
    // The system font: Onest for the whole of Windows (menus, tooltips, title
    // bars, the little labels under the desktop icons — the ones that looked off).
    // ---------------------------------------------------------------------------
    internal static class Fonts
    {
        private const string RegFonts = @"Software\Microsoft\Windows NT\CurrentVersion\Fonts";
        private const string Backup = @"Software\Rezonans\FontsBackup";
        private const string FaceName = "Onest";
        private const string FaceSemibold = "Onest SemiBold";

        private static string FontsDir()
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(local, @"Microsoft\Windows\Fonts");
        }

        // Puts the font files where a normal (non-admin) user may install fonts.
        internal static void Install(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) { Program.Log("шрифты: папки нет: " + dir); return; }
            var target = FontsDir();
            Directory.CreateDirectory(target);
            using (var reg = Registry.CurrentUser.CreateSubKey(RegFonts))
            {
                foreach (var src in Directory.GetFiles(dir, "*.ttf"))
                {
                    var name = Path.GetFileName(src);
                    var dst = Path.Combine(target, name);
                    try
                    {
                        // already installed (and loaded by Windows, so locked): keep it
                        bool same = File.Exists(dst) && new FileInfo(dst).Length == new FileInfo(src).Length;
                        if (!same) File.Copy(src, dst, true);
                        ShellNative.AddFontResource(dst);
                        // the per-user Fonts key wants the file name, the title the face name
                        var title = Path.GetFileNameWithoutExtension(name).Replace("-", " ") + " (TrueType)";
                        reg.SetValue(title, name);
                    }
                    catch (Exception e) { Program.Log("шрифт " + name + ": " + e.Message); }
                }
            }
            ShellNative.PostMessage(ShellNative.HWND_BROADCAST, ShellNative.WM_FONTCHANGE, IntPtr.Zero, IntPtr.Zero);
            Program.Log("шрифты установлены");
        }

        // One UI font everywhere. The current fonts are saved first.
        internal static void Apply()
        {
            BackupOne("ncm");
            BackupOne("icon");

            var ncm = new ShellNative.NONCLIENTMETRICS();
            ncm.cbSize = Marshal.SizeOf(typeof(ShellNative.NONCLIENTMETRICS));
            if (ShellNative.SystemParametersInfoNCM(ShellNative.SPI_GETNONCLIENTMETRICS, ncm.cbSize, ref ncm, 0))
            {
                SetFace(ref ncm.lfCaptionFont, FaceSemibold);
                SetFace(ref ncm.lfSmCaptionFont, FaceName);
                SetFace(ref ncm.lfMenuFont, FaceName);
                SetFace(ref ncm.lfStatusFont, FaceName);
                SetFace(ref ncm.lfMessageFont, FaceName);
                ShellNative.SystemParametersInfoNCM(ShellNative.SPI_SETNONCLIENTMETRICS, ncm.cbSize, ref ncm, ShellNative.SPIF_SENDCHANGE);
            }

            var lf = new ShellNative.LOGFONT();
            if (ShellNative.SystemParametersInfoLF(ShellNative.SPI_GETICONTITLELOGFONT, Marshal.SizeOf(typeof(ShellNative.LOGFONT)), ref lf, 0))
            {
                SetFace(ref lf, FaceName); // the labels under the desktop icons
                ShellNative.SystemParametersInfoLF(ShellNative.SPI_SETICONTITLELOGFONT, Marshal.SizeOf(typeof(ShellNative.LOGFONT)), ref lf, ShellNative.SPIF_SENDCHANGE);
            }

            Program.Send(new Dictionary<string, object> { { "type", "fonts" }, { "applied", true } });
            Program.Log("системный шрифт: Onest");
        }

        internal static void Restore()
        {
            RestoreOne("ncm");
            RestoreOne("icon");
            Program.Send(new Dictionary<string, object> { { "type", "fonts" }, { "applied", false } });
            Program.Log("системный шрифт: как было");
        }

        private static void SetFace(ref ShellNative.LOGFONT lf, string face)
        {
            lf.lfFaceName = face;
            lf.lfQuality = 5; // CLEARTYPE_QUALITY
        }

        private static void BackupOne(string what)
        {
            try
            {
                using (var reg = Registry.CurrentUser.CreateSubKey(Backup))
                {
                    if (reg.GetValue(what) != null) return; // keep the first (truly original) backup
                    if (what == "ncm")
                    {
                        var ncm = new ShellNative.NONCLIENTMETRICS();
                        ncm.cbSize = Marshal.SizeOf(typeof(ShellNative.NONCLIENTMETRICS));
                        if (ShellNative.SystemParametersInfoNCM(ShellNative.SPI_GETNONCLIENTMETRICS, ncm.cbSize, ref ncm, 0))
                            reg.SetValue(what, StructToBytes(ncm), RegistryValueKind.Binary);
                    }
                    else
                    {
                        var lf = new ShellNative.LOGFONT();
                        if (ShellNative.SystemParametersInfoLF(ShellNative.SPI_GETICONTITLELOGFONT, Marshal.SizeOf(typeof(ShellNative.LOGFONT)), ref lf, 0))
                            reg.SetValue(what, StructToBytes(lf), RegistryValueKind.Binary);
                    }
                }
            }
            catch (Exception e) { Program.Log("шрифты (сохранить): " + e.Message); }
        }

        private static void RestoreOne(string what)
        {
            try
            {
                using (var reg = Registry.CurrentUser.OpenSubKey(Backup, true))
                {
                    var data = reg?.GetValue(what) as byte[];
                    if (data == null) return;
                    if (what == "ncm")
                    {
                        var ncm = (ShellNative.NONCLIENTMETRICS)BytesToStruct(data, typeof(ShellNative.NONCLIENTMETRICS));
                        ncm.cbSize = Marshal.SizeOf(typeof(ShellNative.NONCLIENTMETRICS));
                        ShellNative.SystemParametersInfoNCM(ShellNative.SPI_SETNONCLIENTMETRICS, ncm.cbSize, ref ncm, ShellNative.SPIF_SENDCHANGE);
                    }
                    else
                    {
                        var lf = (ShellNative.LOGFONT)BytesToStruct(data, typeof(ShellNative.LOGFONT));
                        ShellNative.SystemParametersInfoLF(ShellNative.SPI_SETICONTITLELOGFONT, Marshal.SizeOf(typeof(ShellNative.LOGFONT)), ref lf, ShellNative.SPIF_SENDCHANGE);
                    }
                    reg.DeleteValue(what, false);
                }
            }
            catch (Exception e) { Program.Log("шрифты (вернуть): " + e.Message); }
        }

        private static byte[] StructToBytes(object o)
        {
            int n = Marshal.SizeOf(o);
            var b = new byte[n];
            var p = Marshal.AllocHGlobal(n);
            try { Marshal.StructureToPtr(o, p, false); Marshal.Copy(p, b, 0, n); }
            finally { Marshal.FreeHGlobal(p); }
            return b;
        }

        private static object BytesToStruct(byte[] b, Type t)
        {
            var p = Marshal.AllocHGlobal(b.Length);
            try { Marshal.Copy(b, 0, p, b.Length); return Marshal.PtrToStructure(p, t); }
            finally { Marshal.FreeHGlobal(p); }
        }
    }
}
