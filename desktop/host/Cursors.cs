// Резонанс для ПК — the mouse pointers in Резонанс's colours. Windows' own pointers
// (the ones that were there before: the arrow, link hand, text, busy, working
// in the background, the resize and move arrows, crosshair, "unavailable",
// help, pen, alternate select, location, person) keep their shapes and are
// recoloured pixel by pixel in the chosen palette: the light body turns deep
// plum, the dark outline turns into a neon edge running through the palette's
// colours, the soft shadow into a glow, and coloured parts (the busy ring) take
// the palette too. Every size inside a file and every frame of an animation is
// recoloured, so they stay as sharp and as smooth as Windows' own.
//
// They go into a scheme of Windows' own (Control Panel\Cursors); the pointers
// that were there are saved first and put back by Restore.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Rezonans
{
    internal static class Cursors
    {
        private const string RegCursors = @"Control Panel\Cursors";
        private const string Backup = @"Software\Rezonans\CursorsBackup";
        private const string SchemeName = "Резонанс";
        private const string None = "\u0001none";

        // the registry names, in the order Windows lists a scheme, and the file each
        // one has in Windows' own scheme (text and crosshair are built in there:
        // their look-alikes from the Cursors folder stand in)
        private static readonly string[][] Stock =
        {
            new[] { "Arrow", "aero_arrow.cur" }, new[] { "Help", "aero_helpsel.cur" }, new[] { "AppStarting", "aero_working.ani" },
            new[] { "Wait", "aero_busy.ani" }, new[] { "Crosshair", "cross_r.cur" }, new[] { "IBeam", "beam_r.cur" },
            new[] { "NWPen", "aero_pen.cur" }, new[] { "No", "aero_unavail.cur" }, new[] { "SizeNS", "aero_ns.cur" },
            new[] { "SizeWE", "aero_ew.cur" }, new[] { "SizeNWSE", "aero_nwse.cur" }, new[] { "SizeNESW", "aero_nesw.cur" },
            new[] { "SizeAll", "aero_move.cur" }, new[] { "UpArrow", "aero_up.cur" }, new[] { "Hand", "aero_link.cur" },
            new[] { "Pin", "aero_pin.cur" }, new[] { "Person", "aero_person.cur" },
        };

        private static Color _c1, _c2, _c3;

        // ---------- on and off ----------

        internal static void Apply(string c1, string c2, string c3)
        {
            try
            {
                SetColors(c1, c2, c3);
                SaveBackup();
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rezonans", "cursors", Key());
                Directory.CreateDirectory(dir);
                var files = Write(dir);
                using (var reg = Registry.CurrentUser.CreateSubKey(RegCursors))
                {
                    foreach (var kv in files) reg.SetValue(kv.Key, kv.Value, RegistryValueKind.ExpandString);
                    reg.SetValue("", SchemeName);
                    reg.SetValue("Scheme Source", 1, RegistryValueKind.DWord);
                }
                using (var schemes = Registry.CurrentUser.CreateSubKey(RegCursors + @"\Schemes"))
                {
                    var list = new List<string>();
                    foreach (var s in Stock) list.Add(files.TryGetValue(s[0], out var f) ? f : "");
                    schemes.SetValue(SchemeName, string.Join(",", list), RegistryValueKind.ExpandString);
                }
                Reload();
                CleanOld(dir);
                Program.Log("курсоры Резонанса: " + files.Count + " шт., " + c1 + " " + c2 + " " + c3);
            }
            catch (Exception e) { Program.Log("курсоры: " + e.Message); }
        }

        internal static void Restore()
        {
            try
            {
                using (var bk = Registry.CurrentUser.OpenSubKey(Backup))
                {
                    if (bk == null) return;
                    using (var reg = Registry.CurrentUser.CreateSubKey(RegCursors))
                    {
                        foreach (var s in Stock)
                        {
                            var v = bk.GetValue(s[0]) as string;
                            reg.SetValue(s[0], v == null || v == None ? "" : v, RegistryValueKind.ExpandString);
                        }
                        var scheme = bk.GetValue("_scheme") as string;
                        reg.SetValue("", scheme == null || scheme == None ? "" : scheme);
                        var src = bk.GetValue("_source");
                        if (src is int n) reg.SetValue("Scheme Source", n, RegistryValueKind.DWord);
                    }
                }
                Registry.CurrentUser.DeleteSubKeyTree(Backup, false);
                using (var schemes = Registry.CurrentUser.OpenSubKey(RegCursors + @"\Schemes", true)) schemes?.DeleteValue(SchemeName, false);
                Reload();
                Program.Log("курсоры: как было");
            }
            catch (Exception e) { Program.Log("курсоры (вернуть): " + e.Message); }
        }

        // the pointers that were there before Резонанс: saved once, so they can come back
        private static void SaveBackup()
        {
            using (var existing = Registry.CurrentUser.OpenSubKey(Backup)) if (existing != null) return;
            using (var reg = Registry.CurrentUser.OpenSubKey(RegCursors))
            using (var bk = Registry.CurrentUser.CreateSubKey(Backup))
            {
                foreach (var s in Stock) bk.SetValue(s[0], reg?.GetValue(s[0], null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string ?? None);
                bk.SetValue("_scheme", reg?.GetValue("") as string ?? None);
                var src = reg?.GetValue("Scheme Source");
                if (src is int n) bk.SetValue("_source", n, RegistryValueKind.DWord);
            }
        }

        private static void Reload()
        {
            SystemParametersInfo(0x0057 /* SPI_SETCURSORS */, 0, IntPtr.Zero, 0x01 | 0x02);
        }

        private static void CleanOld(string keep)
        {
            try
            {
                foreach (var d in Directory.GetDirectories(Path.GetDirectoryName(keep)))
                    if (!string.Equals(d, keep, StringComparison.OrdinalIgnoreCase))
                        try { Directory.Delete(d, true); } catch { /* still in use: next time */ }
            }
            catch { }
        }

        private static string Key()
        {
            Func<Color, string> h = c => c.R.ToString("x2") + c.G.ToString("x2") + c.B.ToString("x2");
            return "v2-" + h(_c1) + "-" + h(_c2) + "-" + h(_c3);
        }

        private static void SetColors(string c1, string c2, string c3)
        {
            _c1 = Parse(c1, Color.FromArgb(0x7c, 0x4d, 0xff));
            _c2 = Parse(c2, Color.FromArgb(0xc3, 0xa6, 0xff));
            _c3 = Parse(c3, Color.FromArgb(0xff, 0x6f, 0xd8));
        }

        private static Color Parse(string hex, Color fallback)
        {
            try
            {
                var h = (hex ?? "").Trim().TrimStart('#');
                if (h.Length != 6) return fallback;
                return Color.FromArgb(Convert.ToInt32(h.Substring(0, 2), 16), Convert.ToInt32(h.Substring(2, 2), 16), Convert.ToInt32(h.Substring(4, 2), 16));
            }
            catch { return fallback; }
        }

        // ---------- the files ----------

        // the pointer a name had before Резонанс (or Windows' own), as a file
        private static string Source(string name, string stock)
        {
            string was = null;
            try
            {
                using (var bk = Registry.CurrentUser.OpenSubKey(Backup)) was = bk?.GetValue(name) as string;
            }
            catch { }
            if (!string.IsNullOrEmpty(was) && was != None)
            {
                var p = Environment.ExpandEnvironmentVariables(was);
                if (File.Exists(p) && (p.EndsWith(".cur", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".ani", StringComparison.OrdinalIgnoreCase))) return p;
            }
            var own = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Cursors", stock);
            return File.Exists(own) ? own : null;
        }

        private static Dictionary<string, string> Write(string dir)
        {
            var map = new Dictionary<string, string>();
            foreach (var s in Stock)
            {
                var src = Source(s[0], s[1]);
                if (src == null) continue;
                try
                {
                    var bytes = File.ReadAllBytes(src);
                    if (src.EndsWith(".ani", StringComparison.OrdinalIgnoreCase)) RecolorAni(bytes);
                    else RecolorCur(bytes, 0, bytes.Length);
                    var path = Path.Combine(dir, s[0].ToLowerInvariant() + Path.GetExtension(src).ToLowerInvariant());
                    File.WriteAllBytes(path, bytes);
                    map[s[0]] = path;
                }
                catch (Exception e) { Program.Log("курсор " + s[0] + ": " + e.Message); }
            }
            return map;
        }

        // an .ani is RIFF "ACON": every "icon" chunk inside is a whole .cur
        private static void RecolorAni(byte[] b)
        {
            if (b.Length < 12 || b[0] != 'R' || b[1] != 'I' || b[2] != 'F' || b[3] != 'F') return;
            Chunks(b, 12, b.Length);
        }

        private static void Chunks(byte[] b, int at, int end)
        {
            while (at + 8 <= end)
            {
                string id = "" + (char)b[at] + (char)b[at + 1] + (char)b[at + 2] + (char)b[at + 3];
                int size = BitConverter.ToInt32(b, at + 4);
                int data = at + 8;
                if (size < 0 || data + size > end) return;
                if (id == "LIST") Chunks(b, data + 4, data + size);
                else if (id == "icon") RecolorCur(b, data, size);
                at = data + size + (size & 1);
            }
        }

        // a .cur/.ico: every 32-bit image in it is recoloured where it lies
        private static void RecolorCur(byte[] b, int at, int len)
        {
            if (len < 6) return;
            int count = BitConverter.ToUInt16(b, at + 4);
            for (int i = 0; i < count; i++)
            {
                int e = at + 6 + 16 * i;
                if (e + 16 > at + len) return;
                int size = BitConverter.ToInt32(b, e + 8);
                int off = at + BitConverter.ToInt32(b, e + 12);
                if (off + 40 > at + len || off + size > at + len) continue;
                if (b[off] == 0x89) continue; // a PNG image: left as it is (Windows' own have none)
                int w = BitConverter.ToInt32(b, off + 4);
                int h = BitConverter.ToInt32(b, off + 8) / 2;
                int bpp = BitConverter.ToUInt16(b, off + 14);
                int head = BitConverter.ToInt32(b, off);
                if (bpp != 32 || w <= 0 || h <= 0 || off + head + w * h * 4 > at + len) continue;
                Recolor(b, off + head, w, h);
            }
        }

        // the colour work, on bottom-up BGRA rows
        private static void Recolor(byte[] b, int px, int w, int h)
        {
            // where the pointer itself is (before the glow is added around it)
            var solid = new byte[w * h];
            for (int k = 0; k < w * h; k++) solid[k] = b[px + k * 4 + 3];
            var body = Color.FromArgb(34, 22, 62);
            for (int row = 0; row < h; row++)
            {
                int y = h - 1 - row; // the picture's own row, top down
                for (int x = 0; x < w; x++)
                {
                    int i = px + (row * w + x) * 4;
                    int a = b[i + 3];
                    if (a == 0) continue;
                    float bl = b[i] / 255f, gr = b[i + 1] / 255f, rd = b[i + 2] / 255f;
                    float max = Math.Max(rd, Math.Max(gr, bl)), min = Math.Min(rd, Math.Min(gr, bl));
                    float lum = 0.299f * rd + 0.587f * gr + 0.114f * bl;
                    float sat = max > 0 ? (max - min) / max : 0;
                    // where on the palette this pixel sits: along the pointer, top-left to bottom-right
                    float t = (x + y) / (float)(w + h - 2);
                    Color edge = Along(t);
                    Color c;
                    if (sat > 0.35f)
                    {
                        // a coloured part (the busy ring): the palette, its light and dark
                        // kept — darker turns to the first colour, lighter to the last
                        var p = Along((lum - 0.25f) / 0.55f);
                        c = Mix(p, Color.White, Math.Max(0, lum - 0.8f) * 2);
                    }
                    else
                    {
                        // light → the deep body, dark → the neon edge
                        c = Mix(edge, body, lum);
                        // the soft shadow becomes a glow: a little stronger, in the palette
                        if (lum < 0.25f && a < 230) a = Math.Min(255, (int)(a * 1.5f) + 6);
                    }
                    b[i] = c.B;
                    b[i + 1] = c.G;
                    b[i + 2] = c.R;
                    b[i + 3] = (byte)a;
                }
            }
            Glow(b, px, w, h, solid);
        }

        // a soft neon glow around the pointer, a couple of pixels wide (more at the
        // bigger sizes), in the palette — so the dark body reads on a dark screen too
        private static void Glow(byte[] b, int px, int w, int h, byte[] solid)
        {
            int r = Math.Max(2, (int)Math.Round(w / 14f));
            for (int row = 0; row < h; row++)
            {
                int y = h - 1 - row;
                for (int x = 0; x < w; x++)
                {
                    int k = row * w + x;
                    if (solid[k] > 40) continue;
                    // the nearest solid pixel
                    float best = r + 1;
                    for (int dy = -r; dy <= r && best > 1; dy++)
                    {
                        int rr = row + dy;
                        if (rr < 0 || rr >= h) continue;
                        for (int dx = -r; dx <= r; dx++)
                        {
                            int xx = x + dx;
                            if (xx < 0 || xx >= w || solid[rr * w + xx] < 160) continue;
                            float d = (float)Math.Sqrt(dx * dx + dy * dy);
                            if (d < best) best = d;
                        }
                    }
                    if (best > r) continue;
                    float k2 = 1 - (best - 1) / r;
                    int ga = (int)(150 * k2 * k2);
                    int i = px + k * 4;
                    if (ga <= b[i + 3]) continue;
                    var c = Along((x + y) / (float)(w + h - 2));
                    b[i] = c.B;
                    b[i + 1] = c.G;
                    b[i + 2] = c.R;
                    b[i + 3] = (byte)ga;
                }
            }
        }

        private static Color Along(float t)
        {
            t = Math.Max(0, Math.Min(1, t));
            return t < 0.5f ? Mix(_c1, _c2, t * 2) : Mix(_c2, _c3, (t - 0.5f) * 2);
        }

        private static Color Mix(Color a, Color b, float k)
        {
            k = Math.Max(0, Math.Min(1, k));
            return Color.FromArgb((int)(a.R + (b.R - a.R) * k), (int)(a.G + (b.G - a.G) * k), (int)(a.B + (b.B - a.B) * k));
        }

        // ---------- a sheet of all of them, to look at (RezonansHost --cursor-sheet) ----------

        internal static void Sheet(string outPng, string c1, string c2, string c3)
        {
            SetColors(c1, c2, c3);
            var dir = Path.GetDirectoryName(Path.GetFullPath(outPng));
            var files = Write(dir);
            int cell = 96, cols = 6, rows = (Stock.Length + cols - 1) / cols;
            using (var sheet = new Bitmap(cols * cell * 2, rows * cell))
            using (var g = Graphics.FromImage(sheet))
            {
                // the left half on dark, the right half on white: they must read on both
                g.Clear(Color.FromArgb(24, 18, 40));
                using (var white = new SolidBrush(Color.FromArgb(246, 246, 250))) g.FillRectangle(white, cols * cell, 0, cols * cell, rows * cell);
                for (int i = 0; i < Stock.Length; i++)
                {
                    if (!files.TryGetValue(Stock[i][0], out var f)) continue;
                    using (var bmp = Preview(File.ReadAllBytes(f), 64))
                    {
                        if (bmp == null) continue;
                        int x = (i % cols) * cell, y = (i / cols) * cell;
                        g.DrawImage(bmp, x + 16, y + 16, 64, 64);
                        g.DrawImage(bmp, cols * cell + x + 16, y + 16, 64, 64);
                    }
                }
                sheet.Save(outPng, ImageFormat.Png);
            }
        }

        // the 64 px image of a .cur (or of the 6th frame of an .ani), as a picture
        private static Bitmap Preview(byte[] b, int want)
        {
            int at = 0, len = b.Length;
            if (b[0] == 'R')
            {
                int found = 0;
                for (int i = 12; i + 8 < b.Length; i++)
                    if (b[i] == 'i' && b[i + 1] == 'c' && b[i + 2] == 'o' && b[i + 3] == 'n' && ++found == 6)
                    {
                        len = BitConverter.ToInt32(b, i + 4);
                        at = i + 8;
                        break;
                    }
                if (at == 0) return null;
            }
            int count = BitConverter.ToUInt16(b, at + 4);
            for (int i = 0; i < count; i++)
            {
                int e = at + 6 + 16 * i;
                int off = at + BitConverter.ToInt32(b, e + 12);
                int w = BitConverter.ToInt32(b, off + 4), h = BitConverter.ToInt32(b, off + 8) / 2;
                if (w != want || BitConverter.ToUInt16(b, off + 14) != 32) continue;
                int px = off + BitConverter.ToInt32(b, off);
                var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
                for (int row = 0; row < h; row++)
                    for (int x = 0; x < w; x++)
                    {
                        int p = px + (row * w + x) * 4;
                        bmp.SetPixel(x, h - 1 - row, Color.FromArgb(b[p + 3], b[p + 2], b[p + 1], b[p]));
                    }
                return bmp;
            }
            return null;
        }

        [DllImport("user32.dll", SetLastError = true)] private static extern bool SystemParametersInfo(uint action, uint param, IntPtr pv, uint winIni);
    }
}
