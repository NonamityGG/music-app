// Резонанс для ПК — the apps for the Start menu (the shortcuts Windows keeps in
// the Start Menu folders, with their icons), the recent files, launching things
// and the power actions.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace Rezonans
{
    internal static class Apps
    {
        internal static List<Dictionary<string, object>> List()
        {
            var seen = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            var outList = new List<Dictionary<string, object>>();
            foreach (var root in new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms),
            })
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                Collect(root, seen, outList);
            }
            outList.Sort((a, b) => string.Compare((string)a["name"], (string)b["name"], StringComparison.CurrentCultureIgnoreCase));
            return outList;
        }

        private static void Collect(string dir, Dictionary<string, bool> seen, List<Dictionary<string, object>> outList)
        {
            string[] files;
            try { files = Directory.GetFiles(dir); } catch { files = new string[0]; }
            foreach (var f in files)
            {
                var ext = Path.GetExtension(f).ToLowerInvariant();
                if (ext != ".lnk" && ext != ".url") continue;
                var name = Path.GetFileNameWithoutExtension(f);
                var low = name.ToLowerInvariant();
                if (low.Contains("uninstall") || low.Contains("deinstall") || low.Contains("удал") || low.Contains("readme") || low.Contains("help") && low.Contains("online")) continue;
                if (seen.ContainsKey(name)) continue;
                seen[name] = true;
                outList.Add(new Dictionary<string, object>
                {
                    { "name", name },
                    { "path", f },
                    { "icon", IconOf(f) },
                });
            }
            string[] subs;
            try { subs = Directory.GetDirectories(dir); } catch { subs = new string[0]; }
            foreach (var s in subs) Collect(s, seen, outList);
        }

        // the shell icon of a shortcut as a base64 PNG (48×48)
        internal static string IconOf(string path)
        {
            IntPtr hIcon = IntPtr.Zero;
            try
            {
                var info = new ShellNative.SHFILEINFO();
                ShellNative.SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(info), ShellNative.SHGFI_ICON | ShellNative.SHGFI_LARGEICON);
                hIcon = info.hIcon;
                if (hIcon == IntPtr.Zero) return "";
                using (var ic = Icon.FromHandle(hIcon))
                using (var bmp = ic.ToBitmap())
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
            finally { if (hIcon != IntPtr.Zero) ShellNative.DestroyIcon(hIcon); }
        }

        internal static List<Dictionary<string, object>> Recent()
        {
            var outList = new List<Dictionary<string, object>>();
            try
            {
                var dir = Environment.GetFolderPath(Environment.SpecialFolder.Recent);
                if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return outList;
                var files = new List<FileInfo>();
                foreach (var f in Directory.GetFiles(dir, "*.lnk")) { try { files.Add(new FileInfo(f)); } catch { } }
                files.Sort((a, b) => b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc));
                int n = 0;
                foreach (var fi in files)
                {
                    if (n++ >= 10) break;
                    outList.Add(new Dictionary<string, object>
                    {
                        { "name", Path.GetFileNameWithoutExtension(fi.Name) },
                        { "path", fi.FullName },
                        { "icon", IconOf(fi.FullName) },
                    });
                }
            }
            catch (Exception e) { Program.Log("недавнее: " + e.Message); }
            return outList;
        }

        internal static void Launch(string path, string args)
        {
            try
            {
                if (string.IsNullOrEmpty(path)) return;
                ShellNative.ShellExecute(IntPtr.Zero, "open", path, args ?? "", null, 1 /* SW_SHOWNORMAL */);
            }
            catch (Exception e) { Program.Log("запуск: " + e.Message); }
        }

        internal static void Power(string action)
        {
            try
            {
                switch (action)
                {
                    case "shutdown": Launch("shutdown.exe", "/s /t 0"); break;
                    case "restart": Launch("shutdown.exe", "/r /t 0"); break;
                    case "signout": Launch("shutdown.exe", "/l"); break;
                    case "lock": ShellNative.LockWorkStation(); break;
                    case "sleep": ShellNative.SetSuspendState(false, false, false); break;
                }
            }
            catch (Exception e) { Program.Log("питание: " + e.Message); }
        }
    }
}
