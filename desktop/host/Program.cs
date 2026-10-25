// RezonansHost: the Windows-side helper of Резонанс for PC.
//
// The Electron app starts it and talks to it with one JSON object per line:
//   in  (stdin):  {"cmd":"hello"} | {"cmd":"attach",...} | {"cmd":"appbar",...} |
//                 {"cmd":"appbarRemove"} | {"cmd":"media","action":...} |
//                 {"cmd":"own","hwnds":[...]} | {"cmd":"refreshWallpaper"} | {"cmd":"quit"}
//   out (stdout): {"type":"hello",...} | {"type":"attached",...} | {"type":"appbar",...} |
//                 {"type":"media",...} | {"type":"fg",...} | {"type":"log","msg":...}
//
// What it does:
//   * puts the wallpaper windows behind the desktop icons (classic WorkerW, and the
//     "raised desktop" of Windows 11 24H2+ where everything lives inside Progman);
//   * registers the top bar as an app bar, so maximised windows stop below it;
//   * reads what is playing from the system media controls (any player that shows
//     up in the Windows volume flyout) and passes play/pause/next/previous/seek;
//   * watches the window in front, so the wallpaper can rest while it is covered.
// When stdin closes (the app quit or crashed) it removes the app bar and puts the
// normal wallpaper back on screen.

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Rezonans
{
    internal static class Program
    {
        private static readonly object OutLock = new object();
        private static StreamWriter _out;
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        [MTAThread]
        private static int Main()
        {
            // a crash must not hang on the Windows error dialog: report and leave
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                try { Console.Error.WriteLine("crash: " + e.ExceptionObject); Console.Error.Flush(); } catch { }
                Environment.Exit(3);
            };
            _out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { /* the manifest already asks for it */ }

            // the media controls need WinRT; if this Windows lacks it, the rest still works
            try { Media.Start(); } catch (Exception e) { Log("медиа недоступны: " + e.Message); }
            try { Foreground.Start(); } catch (Exception e) { Log("окна: " + e.Message); }

            string line;
            while ((line = input.ReadLine()) != null)
            {
                line = line.Trim();
                if (line.Length == 0) continue;
                try
                {
                    if (!Handle(line)) break;
                }
                catch (Exception e)
                {
                    Log("ошибка команды: " + e.Message);
                }
            }
            Cleanup();
            return 0;
        }

        private static void Cleanup()
        {
            try { AppBar.Remove(); } catch { }
            try { Wallpaper.Refresh(); } catch { }
        }

        internal static void Send(Dictionary<string, object> o)
        {
            string s;
            try { s = Json.Serialize(o); } catch (Exception e) { s = "{\"type\":\"log\",\"msg\":\"serialize: " + e.Message.Replace("\"", "'") + "\"}"; }
            lock (OutLock)
            {
                try
                {
                    _out.Write(s);
                    _out.Write('\n');
                    _out.Flush();
                }
                catch { /* the app is gone */ }
            }
        }

        internal static void Log(string msg)
        {
            Send(new Dictionary<string, object> { { "type", "log" }, { "msg", msg } });
        }

        private static string Str(Dictionary<string, object> c, string k, string def = "")
        {
            return c.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture) : def;
        }

        private static int Int(Dictionary<string, object> c, string k, int def = 0)
        {
            if (!c.TryGetValue(k, out var v) || v == null) return def;
            try { return Convert.ToInt32(Math.Round(Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture))); } catch { return def; }
        }

        internal static IntPtr Hwnd(string s)
        {
            return long.TryParse(s, out var v) ? new IntPtr(v) : IntPtr.Zero;
        }

        private static Native.RECT Rect(Dictionary<string, object> c)
        {
            int x = Int(c, "x"), y = Int(c, "y");
            return new Native.RECT { Left = x, Top = y, Right = x + Int(c, "w"), Bottom = y + Int(c, "h") };
        }

        private static bool Handle(string line)
        {
            var c = Json.Deserialize<Dictionary<string, object>>(line);
            if (c == null) return true;
            var cmd = Str(c, "cmd");
            switch (cmd)
            {
                case "hello":
                    {
                        var pm = Native.FindWindow("Progman", null);
                        Send(new Dictionary<string, object>
                        {
                            { "type", "hello" },
                            { "appbarMsg", (long)AppBar.Msg },
                            { "taskbarCreated", (long)Native.RegisterWindowMessage("TaskbarCreated") },
                            { "raised", pm != IntPtr.Zero && Wallpaper.Raised(pm) },
                            { "os", Environment.OSVersion.VersionString },
                        });
                        break;
                    }
                case "own":
                    {
                        var list = new HashSet<long>();
                        if (c.TryGetValue("hwnds", out var arr) && arr is IEnumerable e)
                            foreach (var x in e)
                                if (long.TryParse(Convert.ToString(x), out var v)) list.Add(v);
                        Foreground.Own = list;
                        break;
                    }
                case "attach":
                    {
                        var r = Wallpaper.Attach(Hwnd(Str(c, "hwnd")), Rect(c), Str(c, "mode", "auto"));
                        r["type"] = "attached";
                        r["id"] = Str(c, "id");
                        Send(r);
                        break;
                    }
                case "refreshWallpaper":
                    Wallpaper.Refresh();
                    break;
                case "appbar":
                    {
                        var rc = AppBar.Set(Hwnd(Str(c, "hwnd")), Rect(c), Int(c, "height", 36));
                        Send(new Dictionary<string, object>
                        {
                            { "type", "appbar" },
                            { "ok", true },
                            { "x", rc.Left }, { "y", rc.Top }, { "w", rc.Right - rc.Left }, { "h", rc.Bottom - rc.Top },
                        });
                        break;
                    }
                case "appbarRemove":
                    AppBar.Remove();
                    break;
                case "media":
                    Media.Command(Str(c, "action"), Int(c, "pos", -1));
                    break;
                case "quit":
                    return false;
                default:
                    Log("неизвестная команда " + cmd);
                    break;
            }
            return true;
        }
    }

    // ---------------------------------------------------------------------------
    // Wallpaper behind the desktop icons
    // ---------------------------------------------------------------------------
    internal static class Wallpaper
    {
        // Windows 11 24H2+ "raised desktop": Progman composes through DirectComposition
        // and keeps the icons (SHELLDLL_DefView) and the wallpaper layer (WorkerW) as
        // its own children. Older Windows: two top-level WorkerW windows.
        internal static bool Raised(IntPtr progman)
        {
            return (Native.GetWindowLongPtr(progman, Native.GWL_EXSTYLE).ToInt64() & Native.WS_EX_NOREDIRECTIONBITMAP) != 0;
        }

        private static IntPtr RaisedWorker(IntPtr progman)
        {
            return Native.FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        }

        private static IntPtr ClassicWorker()
        {
            var found = IntPtr.Zero;
            Native.EnumWindows((top, l) =>
            {
                if (Native.FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                {
                    found = Native.FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        // Asks Explorer to split the desktop into "icons" and "wallpaper" layers (the
        // message the wallpaper slideshow uses). Only when it isn't split already.
        private static void Split(IntPtr progman, bool raised)
        {
            Func<bool> has = () => raised ? RaisedWorker(progman) != IntPtr.Zero : ClassicWorker() != IntPtr.Zero;
            if (has()) return;
            Native.SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), Native.SMTO_NORMAL, 1000, out _);
            for (var i = 0; i < 20 && !has(); i++) Thread.Sleep(100);
            if (has()) return;
            Native.SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, Native.SMTO_NORMAL, 1000, out _);
            for (var i = 0; i < 20 && !has(); i++) Thread.Sleep(100);
        }

        private static void MakeChild(IntPtr h, bool layered)
        {
            long st = Native.GetWindowLongPtr(h, Native.GWL_STYLE).ToInt64();
            st &= ~(Native.WS_POPUP | Native.WS_CAPTION | Native.WS_THICKFRAME | Native.WS_SYSMENU | Native.WS_MINIMIZEBOX | Native.WS_MAXIMIZEBOX);
            st |= Native.WS_CHILD | Native.WS_VISIBLE;
            Native.SetWindowLongPtr(h, Native.GWL_STYLE, new IntPtr(st));
            long ex = Native.GetWindowLongPtr(h, Native.GWL_EXSTYLE).ToInt64();
            ex &= ~Native.WS_EX_APPWINDOW;
            if (layered) ex |= Native.WS_EX_LAYERED;
            else ex &= ~Native.WS_EX_LAYERED;
            Native.SetWindowLongPtr(h, Native.GWL_EXSTYLE, new IntPtr(ex));
            if (layered) Native.SetLayeredWindowAttributes(h, 0, 255, Native.LWA_ALPHA);
        }

        // mode: auto | layered | child | worker
        internal static Dictionary<string, object> Attach(IntPtr h, Native.RECT screen, string mode)
        {
            var res = new Dictionary<string, object> { { "ok", false } };
            if (h == IntPtr.Zero || !Native.IsWindow(h))
            {
                res["error"] = "нет окна";
                return res;
            }
            var progman = Native.FindWindow("Progman", null);
            if (progman == IntPtr.Zero)
            {
                res["error"] = "не найден рабочий стол (Progman)";
                return res;
            }
            var raised = Raised(progman);
            res["raised"] = raised;
            Split(progman, raised);
            var defView = Native.FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            // Chromium draws through DirectComposition, which works for a plain child window;
            // "layered" (own redirection surface) is the alternative for the raised desktop
            if (mode == "auto" || string.IsNullOrEmpty(mode)) mode = raised ? "child" : "worker";

            IntPtr parent, after;
            string how;
            if (mode == "worker")
            {
                parent = raised ? RaisedWorker(progman) : ClassicWorker();
                after = Native.HWND_TOP;
                how = (raised ? "raised" : "classic") + "-worker";
                if (parent == IntPtr.Zero)
                {
                    parent = progman;
                    after = defView != IntPtr.Zero ? defView : Native.HWND_BOTTOM;
                    how += "-fallback-progman";
                }
            }
            else
            {
                parent = progman;
                // right under the icons, above Explorer's own wallpaper layer
                after = defView != IntPtr.Zero ? defView : Native.HWND_BOTTOM;
                how = "progman-" + mode;
            }

            MakeChild(h, mode == "layered");
            Native.SetParent(h, parent);
            var p = new Native.POINT { X = screen.Left, Y = screen.Top };
            Native.ScreenToClient(parent, ref p);
            int w = screen.Right - screen.Left, hgt = screen.Bottom - screen.Top;
            Native.SetWindowPos(h, after, p.X, p.Y, w, hgt, Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_FRAMECHANGED);
            // if the window kept a resize border, its picture would stop short of the
            // screen edges: grow the window by the border so the picture fills it all
            if (Native.GetClientRect(h, out var cr) && (cr.Right < w || cr.Bottom < hgt))
            {
                var c0 = new Native.POINT();
                Native.ClientToScreen(h, ref c0);
                int bl = c0.X - screen.Left, bt = c0.Y - screen.Top;
                Native.SetWindowPos(h, after, p.X - bl, p.Y - bt, w + (w - cr.Right), hgt + (hgt - cr.Bottom), Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
                res["border"] = bl + "," + bt;
            }
            if (raised && mode != "worker")
            {
                var ww = RaisedWorker(progman);
                if (ww != IntPtr.Zero)
                    Native.SetWindowPos(ww, Native.HWND_BOTTOM, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
            }
            var ok = Native.GetParent(h) == parent;
            res["ok"] = ok;
            res["how"] = how;
            res["mode"] = mode;
            res["at"] = p.X + "," + p.Y;
            if (!ok) res["error"] = "окно не встало под значки";
            return res;
        }

        // Re-applies the user's own wallpaper, which also wipes the last frame of the
        // waves off the desktop layer.
        internal static void Refresh()
        {
            var sb = new StringBuilder(1024);
            Native.SystemParametersInfo(Native.SPI_GETDESKWALLPAPER, (uint)sb.Capacity, sb, 0);
            Native.SystemParametersInfoStr(Native.SPI_SETDESKWALLPAPER, 0, sb.ToString(), Native.SPIF_SENDCHANGE);
        }
    }

    // ---------------------------------------------------------------------------
    // The top bar as an app bar: Windows keeps maximised windows below it
    // ---------------------------------------------------------------------------
    internal static class AppBar
    {
        internal static readonly uint Msg = Native.RegisterWindowMessage("RezonansAppBar");
        private static IntPtr _hwnd = IntPtr.Zero;
        private static bool _registered;

        private static Native.APPBARDATA Data(IntPtr h)
        {
            return new Native.APPBARDATA { cbSize = (uint)Marshal.SizeOf(typeof(Native.APPBARDATA)), hWnd = h };
        }

        internal static Native.RECT Set(IntPtr h, Native.RECT monitor, int height)
        {
            if (_registered && _hwnd != h) Remove();
            var abd = Data(h);
            if (!_registered)
            {
                abd.uCallbackMessage = Msg;
                Native.SHAppBarMessage(Native.ABM_NEW, ref abd);
                _registered = true;
                _hwnd = h;
            }
            abd.uEdge = Native.ABE_TOP;
            abd.rc = new Native.RECT { Left = monitor.Left, Top = monitor.Top, Right = monitor.Right, Bottom = monitor.Top + height };
            Native.SHAppBarMessage(Native.ABM_QUERYPOS, ref abd);
            abd.rc.Bottom = abd.rc.Top + height;
            Native.SHAppBarMessage(Native.ABM_SETPOS, ref abd);
            Native.SetWindowPos(h, IntPtr.Zero, abd.rc.Left, abd.rc.Top, abd.rc.Right - abd.rc.Left, height, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
            return abd.rc;
        }

        internal static void Remove()
        {
            if (!_registered) return;
            var abd = Data(_hwnd);
            Native.SHAppBarMessage(Native.ABM_REMOVE, ref abd);
            _registered = false;
        }
    }

    // ---------------------------------------------------------------------------
    // What is playing: Windows system media transport controls
    // ---------------------------------------------------------------------------
    internal static class Media
    {
        private static GlobalSystemMediaTransportControlsSessionManager _mgr;
        private static string _key = "";
        private static string _thumbKey = "";
        private static string _sent = "";
        private static DateTime _lastPos = DateTime.MinValue;
        private static int _tick;
        private static string _title = "", _artist = "", _album = "";

        internal static void Start()
        {
            var t = new Thread(Run) { IsBackground = true, Name = "media" };
            t.Start();
        }

        private static void Run()
        {
            try
            {
                Init();
            }
            catch (Exception e)
            {
                Program.Log("системные медиа-кнопки недоступны: " + e.Message);
                return;
            }
            while (true)
            {
                try { Tick(); }
                catch (Exception e) { Program.Log("медиа: " + e.Message); }
                Thread.Sleep(500);
            }
        }

        // separate, so a Windows without these WinRT types fails here, inside the try
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        private static void Init()
        {
            _mgr = GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().GetAwaiter().GetResult();
        }

        private static GlobalSystemMediaTransportControlsSession Current()
        {
            return _mgr == null ? null : _mgr.GetCurrentSession();
        }

        private static string StatusName(GlobalSystemMediaTransportControlsSessionPlaybackStatus s)
        {
            switch (s)
            {
                case GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing: return "playing";
                case GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused: return "paused";
                case GlobalSystemMediaTransportControlsSessionPlaybackStatus.Changing: return "changing";
                case GlobalSystemMediaTransportControlsSessionPlaybackStatus.Stopped: return "stopped";
                default: return "none";
            }
        }

        private static void Tick()
        {
            var s = Current();
            if (s == null)
            {
                if (_sent != "none")
                {
                    _sent = "none";
                    _key = "";
                    _thumbKey = "";
                    Program.Send(new Dictionary<string, object> { { "type", "media" }, { "status", "none" } });
                }
                return;
            }
            var app = s.SourceAppUserModelId ?? "";
            // titles change rarely: ask the player for them every second, or at once on a new player
            if (_tick++ % 2 == 0 || !_key.StartsWith(app + "|"))
            {
                var props = s.TryGetMediaPropertiesAsync().AsTask().GetAwaiter().GetResult();
                if (props != null)
                {
                    _title = props.Title ?? "";
                    _artist = props.Artist ?? "";
                    if (_artist.Length == 0) _artist = props.AlbumArtist ?? "";
                    _album = props.AlbumTitle ?? "";
                    var key = app + "|" + _title + "|" + _artist;
                    if (key != _thumbKey)
                    {
                        _thumbKey = key;
                        string thumb = "";
                        try { thumb = ReadThumb(props.Thumbnail); }
                        catch (Exception e) { Program.Log("обложка: " + e.Message); }
                        _key = key;
                        Emit(s, app, thumb, true);
                        return;
                    }
                    _key = key;
                }
            }
            Emit(s, app, null, false);
        }

        private static void Emit(GlobalSystemMediaTransportControlsSession s, string app, string thumb, bool force)
        {
            var info = s.GetPlaybackInfo();
            var tl = s.GetTimelineProperties();
            var status = info != null ? StatusName(info.PlaybackStatus) : "none";
            var playing = status == "playing";
            double durMs = 0, posMs = 0;
            if (tl != null)
            {
                durMs = (tl.EndTime - tl.StartTime).TotalMilliseconds;
                posMs = (tl.Position - tl.StartTime).TotalMilliseconds;
                if (playing && tl.LastUpdatedTime.Year > 2000)
                {
                    var since = (DateTimeOffset.Now - tl.LastUpdatedTime).TotalMilliseconds;
                    if (since > 0 && since < 6 * 3600 * 1000) posMs += since;
                }
                if (durMs > 0) posMs = Math.Max(0, Math.Min(durMs, posMs));
            }
            var ctl = info != null ? info.Controls : null;
            bool canNext = ctl != null && ctl.IsNextEnabled, canPrev = ctl != null && ctl.IsPreviousEnabled;
            var sig = _key + "|" + status + "|" + canNext + "|" + canPrev + "|" + Math.Round(durMs / 1000);
            var now = DateTime.UtcNow;
            // position every second while playing; everything else only when it changes
            if (!force && sig == _sent && !(playing && (now - _lastPos).TotalMilliseconds >= 1000)) return;
            _sent = sig;
            _lastPos = now;
            var o = new Dictionary<string, object>
            {
                { "type", "media" },
                { "status", status },
                { "app", app },
                { "title", _title },
                { "artist", _artist },
                { "album", _album },
                { "pos", Math.Round(posMs) },
                { "dur", Math.Round(durMs) },
                { "canNext", canNext },
                { "canPrev", canPrev },
            };
            if (thumb != null) o["thumb"] = thumb;
            Program.Send(o);
        }

        private static string ReadThumb(IRandomAccessStreamReference r)
        {
            if (r == null) return "";
            using (var st = r.OpenReadAsync().AsTask().GetAwaiter().GetResult())
            {
                if (st == null || st.Size == 0 || st.Size > 8000000) return "";
                using (var s = st.AsStreamForRead())
                using (var ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    var type = string.IsNullOrEmpty(st.ContentType) ? "image/png" : st.ContentType;
                    return "data:" + type + ";base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
        }

        internal static void Command(string action, int posMs)
        {
            var s = Current();
            if (s == null) return;
            switch (action)
            {
                case "toggle": s.TryTogglePlayPauseAsync().AsTask().GetAwaiter().GetResult(); break;
                case "play": s.TryPlayAsync().AsTask().GetAwaiter().GetResult(); break;
                case "pause": s.TryPauseAsync().AsTask().GetAwaiter().GetResult(); break;
                case "next": s.TrySkipNextAsync().AsTask().GetAwaiter().GetResult(); break;
                case "prev": s.TrySkipPreviousAsync().AsTask().GetAwaiter().GetResult(); break;
                case "seek":
                    if (posMs >= 0)
                    {
                        var tl = s.GetTimelineProperties();
                        var start = tl != null ? tl.StartTime : TimeSpan.Zero;
                        s.TryChangePlaybackPositionAsync((start + TimeSpan.FromMilliseconds(posMs)).Ticks).AsTask().GetAwaiter().GetResult();
                    }
                    break;
            }
            _sent = ""; // report the new state right away
        }
    }

    // ---------------------------------------------------------------------------
    // The window in front: the wallpaper rests while a window covers its screen
    // ---------------------------------------------------------------------------
    internal static class Foreground
    {
        internal static HashSet<long> Own = new HashSet<long>();
        private static string _last = "";

        internal static void Start()
        {
            var t = new Thread(() =>
            {
                while (true)
                {
                    try { Tick(); }
                    catch (Exception e) { Program.Log("окна: " + e.Message); }
                    Thread.Sleep(700);
                }
            }) { IsBackground = true, Name = "fg" };
            t.Start();
        }

        private static string ClassOf(IntPtr h)
        {
            var sb = new StringBuilder(256);
            Native.GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }

        private static void Tick()
        {
            var h = Native.GetForegroundWindow();
            bool desktop = false, full = false, max = false;
            var r = new Native.RECT();
            var mr = new Native.RECT();
            if (h == IntPtr.Zero) desktop = true;
            else
            {
                var cls = ClassOf(h);
                if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd" || Own.Contains(h.ToInt64()))
                    desktop = true;
                else
                {
                    if (Native.DwmGetWindowAttribute(h, 9 /* extended frame bounds */, out r, Marshal.SizeOf(typeof(Native.RECT))) != 0)
                        Native.GetWindowRect(h, out r);
                    var mon = Native.MonitorFromWindow(h, 2);
                    var mi = new Native.MONITORINFO { cbSize = Marshal.SizeOf(typeof(Native.MONITORINFO)) };
                    Native.GetMonitorInfo(mon, ref mi);
                    mr = mi.rcMonitor;
                    full = r.Left <= mr.Left && r.Top <= mr.Top && r.Right >= mr.Right && r.Bottom >= mr.Bottom;
                    max = Native.IsZoomed(h) && Native.IsWindowVisible(h);
                }
            }
            var key = desktop + "|" + full + "|" + max + "|" + mr.Left + "," + mr.Top + "," + mr.Right + "," + mr.Bottom;
            if (key == _last) return;
            _last = key;
            Program.Send(new Dictionary<string, object>
            {
                { "type", "fg" },
                { "desktop", desktop },
                { "full", full },
                { "max", max },
                { "mx", mr.Left }, { "my", mr.Top }, { "mw", mr.Right - mr.Left }, { "mh", mr.Bottom - mr.Top },
            });
        }
    }

    // ---------------------------------------------------------------------------
    // Win32
    // ---------------------------------------------------------------------------
    internal static class Native
    {
        internal const int GWL_STYLE = -16;
        internal const int GWL_EXSTYLE = -20;
        internal const long WS_POPUP = 0x80000000L;
        internal const long WS_CHILD = 0x40000000L;
        internal const long WS_VISIBLE = 0x10000000L;
        internal const long WS_CAPTION = 0x00C00000L;
        internal const long WS_THICKFRAME = 0x00040000L;
        internal const long WS_SYSMENU = 0x00080000L;
        internal const long WS_MINIMIZEBOX = 0x00020000L;
        internal const long WS_MAXIMIZEBOX = 0x00010000L;
        internal const long WS_EX_LAYERED = 0x00080000L;
        internal const long WS_EX_APPWINDOW = 0x00040000L;
        internal const long WS_EX_NOREDIRECTIONBITMAP = 0x00200000L;
        internal const uint LWA_ALPHA = 0x2;
        internal const uint SMTO_NORMAL = 0x0;
        internal const uint SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_FRAMECHANGED = 0x0020, SWP_SHOWWINDOW = 0x0040;
        internal static readonly IntPtr HWND_TOP = IntPtr.Zero;
        internal static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
        internal const uint SPI_SETDESKWALLPAPER = 0x0014, SPI_GETDESKWALLPAPER = 0x0073, SPIF_SENDCHANGE = 0x02;
        internal const uint ABM_NEW = 0x0, ABM_REMOVE = 0x1, ABM_QUERYPOS = 0x2, ABM_SETPOS = 0x3;
        internal const uint ABE_TOP = 1;

        [StructLayout(LayoutKind.Sequential)]
        internal struct POINT { public int X, Y; }

        [StructLayout(LayoutKind.Sequential)]
        internal struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct APPBARDATA
        {
            public uint cbSize;
            public IntPtr hWnd;
            public uint uCallbackMessage;
            public uint uEdge;
            public RECT rc;
            public IntPtr lParam;
        }

        internal delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr FindWindow(string cls, string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
        [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetParent(IntPtr child, IntPtr parent);
        [DllImport("user32.dll")] internal static extern IntPtr GetParent(IntPtr h);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] internal static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] internal static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr v);
        [DllImport("user32.dll")] internal static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] internal static extern bool ScreenToClient(IntPtr h, ref POINT p);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] internal static extern bool GetClientRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] internal static extern bool ClientToScreen(IntPtr h, ref POINT p);
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] internal static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern uint RegisterWindowMessage(string s);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW")] internal static extern bool SystemParametersInfo(uint action, uint param, StringBuilder pv, uint winIni);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SystemParametersInfoW")] internal static extern bool SystemParametersInfoStr(uint action, uint param, string pv, uint winIni);
        [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("shell32.dll")] internal static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
        [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    }
}
