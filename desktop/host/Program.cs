// RezonansHost: the Windows-side helper of Резонанс for PC.
//
// The Electron app starts it and talks to it with one JSON object per line:
//   in  (stdin):  {"cmd":"hello"} | {"cmd":"attach",...} | {"cmd":"appbar",...} |
//                 {"cmd":"appbarRemove"} | {"cmd":"media","action":...} |
//                 {"cmd":"own","hwnds":[...]} | {"cmd":"refreshWallpaper"} |
//                 {"cmd":"style","hwnd":...} | {"cmd":"winColorsGet"} | {"cmd":"winColorsSet",...} |
//                 {"cmd":"winColorsRestore","values":{...}} | {"cmd":"wallpaperPath"} | {"cmd":"quit"}
//   out (stdout): {"type":"hello",...} | {"type":"attached",...} | {"type":"appbar",...} |
//                 {"type":"media",...} | {"type":"fg",...} | {"type":"audio",...} |
//                 {"type":"winColorsBackup",...} | {"type":"winColors",...} |
//                 {"type":"wallpaperPath",...} | {"type":"log","msg":...}
//
// What it does:
//   * puts the wallpaper windows behind the desktop icons (classic WorkerW, and the
//     "raised desktop" of Windows 11 24H2+ where everything lives inside Progman);
//   * registers the top bar as an app bar, so maximised windows stop below it;
//   * reads what is playing from the system media controls (any player that shows
//     up in the Windows volume flyout) and passes play/pause/next/previous/seek;
//   * watches the window in front, so the wallpaper can rest while it is covered;
//   * tells when the sound output changes (the waves listen to the new one);
//   * paints Windows itself in the colours of Резонанс: accent, selection, dark
//     theme (everything it changes is read first, so it can be put back).
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
using Microsoft.Win32;
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
            try { AudioWatch.Start(); } catch (Exception e) { Log("звуковые устройства: " + e.Message); }

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
            try { Hooks.Remove(); } catch { }
            try { AppBar.RemoveAll(); } catch { }
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

        internal static bool? Bool(Dictionary<string, object> c, string k)
        {
            return c.TryGetValue(k, out var v) && v is bool b ? b : (bool?)null;
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
                            { "immersive", SysColors.ImmersiveInfo() },
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
                        uint edge = Str(c, "edge") == "bottom" ? Native.ABE_BOTTOM : Native.ABE_TOP;
                        var rc = AppBar.Set(Hwnd(Str(c, "hwnd")), Rect(c), Int(c, "height", 36), edge);
                        Send(new Dictionary<string, object>
                        {
                            { "type", "appbar" },
                            { "ok", true },
                            { "edge", edge == Native.ABE_BOTTOM ? "bottom" : "top" },
                            { "x", rc.Left }, { "y", rc.Top }, { "w", rc.Right - rc.Left }, { "h", rc.Bottom - rc.Top },
                        });
                        break;
                    }
                case "appbarRemove":
                    {
                        var hs = Str(c, "hwnd");
                        if (string.IsNullOrEmpty(hs)) AppBar.RemoveAll();
                        else AppBar.Remove(Hwnd(hs));
                        break;
                    }
                case "probe":
                    Probe.At(Hwnd(Str(c, "hwnd")), Int(c, "x"), Int(c, "y"));
                    break;
                case "toBack":
                    Probe.ToBack(Hwnd(Str(c, "hwnd")));
                    break;
                case "media":
                    Media.Command(Str(c, "action"), Int(c, "pos", -1));
                    break;
                case "style":
                    Look.Style(Hwnd(Str(c, "hwnd")), Int(c, "corner", 2), Str(c, "border", ""), Bool(c, "dark"));
                    break;
                case "winColorsGet":
                    {
                        var r = SysColors.Read();
                        Send(new Dictionary<string, object> { { "type", "winColorsBackup" }, { "values", r } });
                        break;
                    }
                case "winColorsSet":
                    {
                        // broadcasting the change can take a moment (every window hears it)
                        var copy = c;
                        new Thread(() =>
                        {
                            try { Send(SysColors.Apply(copy)); }
                            catch (Exception e) { Log("цвета Windows: " + e.Message); }
                        }) { IsBackground = true }.Start();
                        break;
                    }
                case "winColorsRestore":
                    {
                        var copy = c;
                        new Thread(() =>
                        {
                            try { Send(SysColors.Restore(copy.TryGetValue("values", out var v) ? v as Dictionary<string, object> : null)); }
                            catch (Exception e) { Log("цвета Windows (вернуть): " + e.Message); }
                        }) { IsBackground = true }.Start();
                        break;
                    }
                case "wallpaperPath":
                    Send(new Dictionary<string, object> { { "type", "wallpaperPath" }, { "path", Wallpaper.CurrentPath() } });
                    break;
                case "fontsInstall":
                    Fonts.Install(Str(c, "dir"));
                    Fonts.Apply();
                    break;
                case "fontsApply":
                    Fonts.Apply();
                    break;
                case "fontsRestore":
                    Fonts.Restore();
                    break;
                case "shellHooks":
                    if (Bool(c, "on") == false) Hooks.Remove();
                    else Hooks.Install();
                    break;
                case "apps":
                    Send(new Dictionary<string, object> { { "type", "apps" }, { "list", Apps.List() } });
                    break;
                case "recent":
                    Send(new Dictionary<string, object> { { "type", "recent" }, { "list", Apps.Recent() } });
                    break;
                case "taskwins":
                {
                    var wins = Taskbar.Windows();
                    if (Bool(c, "force") == true || Taskbar.Changed(wins)) Send(new Dictionary<string, object> { { "type", "windows" }, { "list", wins } });
                    break;
                }
                case "activate":
                    if (long.TryParse(Str(c, "hwnd"), out var hw)) Taskbar.Activate(hw);
                    break;
                case "taskbarHide":
                    Taskbar.WindowsTaskbar(Bool(c, "on") == true);
                    break;
                case "launch":
                    Apps.Launch(Str(c, "path"), Str(c, "args"));
                    break;
                case "appsFolder":
                    Apps.Launch("explorer.exe", "shell:AppsFolder");
                    break;
                case "power":
                    Apps.Power(Str(c, "action"));
                    break;
                case "status":
                    Send(Status.Snapshot());
                    break;
                case "volume":
                    Status.SetVolume(Int(c, "level"));
                    Send(Status.Snapshot());
                    break;
                case "mute":
                    Status.SetMute(Bool(c, "on") == true);
                    Send(Status.Snapshot());
                    break;
                case "radio":
                    new Thread(() => { Status.SetRadio(Str(c, "kind"), Bool(c, "on") == true); Send(Status.Snapshot()); }) { IsBackground = true }.Start();
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

        // The picture of the user's own Windows wallpaper (for "waves over my wallpaper").
        internal static string CurrentPath()
        {
            var sb = new StringBuilder(1024);
            Native.SystemParametersInfo(Native.SPI_GETDESKWALLPAPER, (uint)sb.Capacity, sb, 0);
            var p = sb.ToString();
            if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
            // set from Settings: Windows keeps its own copy
            var t = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
            return File.Exists(t) ? t : "";
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
    // Our reserved strips: the bar at the top and, when it is on, the taskbar at
    // the bottom. Each window registers its own appbar (kept by hwnd).
    internal static class AppBar
    {
        internal static readonly uint Msg = Native.RegisterWindowMessage("RezonansAppBar");
        private static readonly Dictionary<IntPtr, bool> _reg = new Dictionary<IntPtr, bool>();

        private static Native.APPBARDATA Data(IntPtr h)
        {
            return new Native.APPBARDATA { cbSize = (uint)Marshal.SizeOf(typeof(Native.APPBARDATA)), hWnd = h };
        }

        internal static Native.RECT Set(IntPtr h, Native.RECT monitor, int height, uint edge)
        {
            var abd = Data(h);
            if (!_reg.ContainsKey(h))
            {
                abd.uCallbackMessage = Msg;
                Native.SHAppBarMessage(Native.ABM_NEW, ref abd);
                _reg[h] = true;
            }
            abd.uEdge = edge;
            if (edge == Native.ABE_BOTTOM)
                abd.rc = new Native.RECT { Left = monitor.Left, Top = monitor.Bottom - height, Right = monitor.Right, Bottom = monitor.Bottom };
            else
                abd.rc = new Native.RECT { Left = monitor.Left, Top = monitor.Top, Right = monitor.Right, Bottom = monitor.Top + height };
            Native.SHAppBarMessage(Native.ABM_QUERYPOS, ref abd);
            if (edge == Native.ABE_BOTTOM) abd.rc.Top = abd.rc.Bottom - height;
            else abd.rc.Bottom = abd.rc.Top + height;
            Native.SHAppBarMessage(Native.ABM_SETPOS, ref abd);
            Native.SetWindowPos(h, IntPtr.Zero, abd.rc.Left, abd.rc.Top, abd.rc.Right - abd.rc.Left, abd.rc.Bottom - abd.rc.Top, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
            return abd.rc;
        }

        internal static void Remove(IntPtr h)
        {
            if (!_reg.ContainsKey(h)) return;
            var abd = Data(h);
            Native.SHAppBarMessage(Native.ABM_REMOVE, ref abd);
            _reg.Remove(h);
        }

        internal static void RemoveAll()
        {
            foreach (var h in new List<IntPtr>(_reg.Keys)) Remove(h);
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
                int n = 0;
                while (true)
                {
                    try { Tick(); }
                    catch (Exception e) { Program.Log("окна: " + e.Message); }
                    try { if (n++ % 3 == 0) CheckGuard(); }
                    catch (Exception e) { Program.Log("античит-проверка: " + e.Message); }
                    Thread.Sleep(700);
                }
            }) { IsBackground = true, Name = "fg" };
            t.Start();
        }

        // An anti-cheat game or client is running: Резонанс should sleep (the main
        // process drops the Win-key hooks and hides its windows). Matched by
        // process name so it fires as the anti-cheat starts, not only in-game.
        private static readonly string[] GuardNames = { "cs2", "csgo", "faceit" };
        private static bool _guard;

        private static void CheckGuard()
        {
            bool found = false;
            var procs = System.Diagnostics.Process.GetProcesses();
            foreach (var p in procs)
            {
                try
                {
                    var nm = p.ProcessName.ToLowerInvariant();
                    foreach (var g in GuardNames) if (nm.Contains(g)) { found = true; break; }
                }
                catch { }
                finally { p.Dispose(); }
                if (found) break;
            }
            if (found == _guard) return;
            _guard = found;
            Program.Send(new Dictionary<string, object> { { "type", "guard" }, { "on", found } });
            Program.Log(found ? "замечена CS2/FACEIT" : "CS2/FACEIT закрыта");
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
            var key = h.ToInt64() + "|" + desktop + "|" + full + "|" + max + "|" + mr.Left + "," + mr.Top + "," + mr.Right + "," + mr.Bottom;
            if (key == _last) return;
            _last = key;
            Program.Send(new Dictionary<string, object>
            {
                { "type", "fg" },
                { "hwnd", h.ToInt64().ToString() },
                { "desktop", desktop },
                { "full", full },
                { "max", max },
                { "mx", mr.Left }, { "my", mr.Top }, { "mw", mr.Right - mr.Left }, { "mh", mr.Bottom - mr.Top },
            });
        }
    }

    // ---------------------------------------------------------------------------
    // Our windows in the Windows 11 style: rounded corners, a quiet dark border
    // ---------------------------------------------------------------------------
    internal static class Look
    {
        internal static void Style(IntPtr h, int corner, string border, bool? dark)
        {
            if (h == IntPtr.Zero || !Native.IsWindow(h)) return;
            int v = corner;
            Native.DwmSetWindowAttribute(h, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, ref v, 4);
            if (dark == true)
            {
                int d = 1;
                Native.DwmSetWindowAttribute(h, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref d, 4);
            }
            if (!string.IsNullOrEmpty(border))
            {
                int c = border == "none" ? unchecked((int)0xFFFFFFFE) : (int)SysColors.ColorRef(border);
                Native.DwmSetWindowAttribute(h, 34 /* DWMWA_BORDER_COLOR */, ref c, 4);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // The sound output changed (headphones plugged in, another device chosen in the
    // volume flyout): the app's loopback still listens to the old one, so it has
    // to start listening again.
    // ---------------------------------------------------------------------------
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorCom
    {
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IMMNotificationClient client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROPERTYKEY
    {
        public Guid fmtid;
        public int pid;
    }

    [ComImport, Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMNotificationClient
    {
        [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int newState);
        [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
        [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
        [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, [MarshalAs(UnmanagedType.LPWStr)] string defaultDeviceId);
        [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, PROPERTYKEY key);
    }

    [ComVisible(true)]
    public class AudioWatch : IMMNotificationClient
    {
        private static IMMDeviceEnumerator _enum;
        private static AudioWatch _client;
        private static Timer _timer;
        private static string _why = "";
        private static readonly object Lock = new object();

        internal static void Start()
        {
            _enum = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
            _client = new AudioWatch();
            var hr = _enum.RegisterEndpointNotificationCallback(_client);
            if (hr != 0) Program.Log("не слежу за звуковыми устройствами: 0x" + hr.ToString("x"));
        }

        // Windows reports one change per role (console, multimedia, communications):
        // send one message after things settle
        private static void Later(string why)
        {
            lock (Lock)
            {
                _why = why;
                if (_timer == null) _timer = new Timer(_ => Fire(), null, 500, Timeout.Infinite);
                else _timer.Change(500, Timeout.Infinite);
            }
        }

        private static void Fire()
        {
            string why;
            lock (Lock) why = _why;
            Program.Send(new Dictionary<string, object> { { "type", "audio" }, { "event", why } });
        }

        public int OnDeviceStateChanged(string deviceId, int newState)
        {
            Later("state");
            return 0;
        }

        public int OnDeviceAdded(string deviceId)
        {
            Later("added");
            return 0;
        }

        public int OnDeviceRemoved(string deviceId)
        {
            Later("removed");
            return 0;
        }

        public int OnDefaultDeviceChanged(int flow, int role, string defaultDeviceId)
        {
            if (flow == 0 /* eRender */) Later("default");
            return 0;
        }

        public int OnPropertyValueChanged(string deviceId, PROPERTYKEY key)
        {
            return 0;
        }
    }

    // ---------------------------------------------------------------------------
    // Windows in the colours of Резонанс: the accent (Start, Settings, focus rings,
    // title bars), the selection colour (the rectangle on the desktop, selected
    // text in classic apps) and, if asked, the dark theme.
    // ---------------------------------------------------------------------------
    internal static class SysColors
    {
        private const string Dwm = @"Software\Microsoft\Windows\DWM";
        private const string Accent = @"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent";
        private const string Desktop = @"Control Panel\Desktop";
        private const string Colors = @"Control Panel\Colors";
        private const string Personalize = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

        // everything that may be changed, read before the first change to put it back
        private static readonly string[][] Values =
        {
            new[] { Dwm, "AccentColor" },
            new[] { Dwm, "ColorizationColor" },
            new[] { Dwm, "ColorizationAfterglow" },
            new[] { Dwm, "ColorPrevalence" },
            new[] { Accent, "AccentPalette" },
            new[] { Accent, "AccentColorMenu" },
            new[] { Accent, "StartColorMenu" },
            new[] { Desktop, "AutoColorization" },
            new[] { Colors, "Hilight" },
            new[] { Colors, "HotTrackingColor" },
            new[] { Personalize, "AppsUseLightTheme" },
            new[] { Personalize, "SystemUsesLightTheme" },
            new[] { Personalize, "ColorPrevalence" },
        };

        internal static Dictionary<string, object> Read()
        {
            var o = new Dictionary<string, object>();
            foreach (var v in Values)
            {
                var e = new Dictionary<string, object> { { "exists", false } };
                using (var k = Registry.CurrentUser.OpenSubKey(v[0]))
                {
                    var val = k == null ? null : k.GetValue(v[1], null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                    if (val != null)
                    {
                        e["exists"] = true;
                        e["kind"] = k.GetValueKind(v[1]).ToString();
                        if (val is byte[] b) e["value"] = Convert.ToBase64String(b);
                        else if (val is int i) e["value"] = (long)unchecked((uint)i);
                        else if (val is long l) e["value"] = l;
                        else e["value"] = Convert.ToString(val);
                    }
                }
                o[v[0] + "|" + v[1]] = e;
            }
            o["sys|highlight"] = new Dictionary<string, object> { { "exists", true }, { "kind", "Sys" }, { "value", (long)Native.GetSysColor(13) } };
            o["sys|hotlight"] = new Dictionary<string, object> { { "exists", true }, { "kind", "Sys" }, { "value", (long)Native.GetSysColor(26) } };
            return o;
        }

        internal static Dictionary<string, object> Restore(Dictionary<string, object> values)
        {
            var res = new Dictionary<string, object> { { "type", "winColors" }, { "restored", true }, { "ok", false } };
            if (values == null) return res;
            var before = CurrentAccent();
            var hi = new List<int>();
            var hc = new List<int>();
            foreach (var kv in values)
            {
                var e = kv.Value as Dictionary<string, object>;
                if (e == null) continue;
                var parts = kv.Key.Split('|');
                if (parts.Length != 2) continue;
                var exists = e.TryGetValue("exists", out var ex) && ex is bool eb && eb;
                var kind = e.TryGetValue("kind", out var kk) ? Convert.ToString(kk) : "";
                e.TryGetValue("value", out var val);
                try
                {
                    if (parts[0] == "sys")
                    {
                        hi.Add(parts[1] == "highlight" ? 13 : 26);
                        hc.Add(unchecked((int)Convert.ToInt64(val)));
                        continue;
                    }
                    using (var k = Registry.CurrentUser.CreateSubKey(parts[0]))
                    {
                        if (!exists)
                        {
                            k.DeleteValue(parts[1], false);
                            continue;
                        }
                        if (kind == "Binary") k.SetValue(parts[1], Convert.FromBase64String(Convert.ToString(val)), RegistryValueKind.Binary);
                        else if (kind == "DWord") k.SetValue(parts[1], unchecked((int)(uint)Convert.ToInt64(val)), RegistryValueKind.DWord);
                        else if (kind == "QWord") k.SetValue(parts[1], Convert.ToInt64(val), RegistryValueKind.QWord);
                        else k.SetValue(parts[1], Convert.ToString(val), RegistryValueKind.String);
                    }
                }
                catch (Exception err)
                {
                    Program.Log("вернуть " + kv.Key + ": " + err.Message);
                }
            }
            if (hi.Count > 0) Native.SetSysColors(hi.Count, hi.ToArray(), hc.ToArray());
            uint accent = 0;
            if (values.TryGetValue(Dwm + "|AccentColor", out var ac) && ac is Dictionary<string, object> ad && ad.TryGetValue("value", out var av) && av != null)
                accent = (uint)Convert.ToInt64(av) & 0xFFFFFF;
            if (accent != 0) res["immersive"] = Immersive(accent, before);
            Broadcast();
            res["ok"] = true;
            return res;
        }

        // "#rrggbb" -> COLORREF 0x00BBGGRR
        internal static uint ColorRef(string hex)
        {
            Rgb(hex, out var r, out var g, out var b);
            return (uint)(r | (g << 8) | (b << 16));
        }

        private static void Rgb(string hex, out int r, out int g, out int b)
        {
            hex = (hex ?? "").Trim().TrimStart('#');
            if (hex.Length != 6) hex = "7c4dff";
            r = Convert.ToInt32(hex.Substring(0, 2), 16);
            g = Convert.ToInt32(hex.Substring(2, 2), 16);
            b = Convert.ToInt32(hex.Substring(4, 2), 16);
        }

        private static void Dword(string path, string name, uint v)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(path)) k.SetValue(name, unchecked((int)v), RegistryValueKind.DWord);
        }

        internal static Dictionary<string, object> Apply(Dictionary<string, object> c)
        {
            var res = new Dictionary<string, object> { { "type", "winColors" }, { "ok", false } };
            var done = new List<string>();
            var before = CurrentAccent();
            var accentHex = c.TryGetValue("accent", out var a) ? Convert.ToString(a) : "";
            if (!string.IsNullOrEmpty(accentHex))
            {
                // eight shades, light to dark, as R G B 0 (index 3 is the accent itself)
                var shades = new List<string>();
                if (c.TryGetValue("palette", out var pv) && pv is IEnumerable pe)
                    foreach (var x in pe) shades.Add(Convert.ToString(x));
                if (shades.Count != 8) shades = new List<string> { accentHex, accentHex, accentHex, accentHex, accentHex, accentHex, accentHex, accentHex };
                var pal = new byte[32];
                for (var i = 0; i < 8; i++)
                {
                    Rgb(shades[i], out var r, out var g, out var b);
                    pal[i * 4] = (byte)r;
                    pal[i * 4 + 1] = (byte)g;
                    pal[i * 4 + 2] = (byte)b;
                    pal[i * 4 + 3] = 0;
                }
                uint abgr = 0xFF000000 | ColorRef(shades[3]);
                uint startAbgr = 0xFF000000 | ColorRef(shades[4]);
                Rgb(shades[3], out var ar, out var ag, out var ab);
                uint argb = 0xC4000000 | (uint)((ar << 16) | (ag << 8) | ab);
                using (var k = Registry.CurrentUser.CreateSubKey(Accent))
                {
                    k.SetValue("AccentPalette", pal, RegistryValueKind.Binary);
                    k.SetValue("AccentColorMenu", unchecked((int)abgr), RegistryValueKind.DWord);
                    k.SetValue("StartColorMenu", unchecked((int)startAbgr), RegistryValueKind.DWord);
                }
                Dword(Dwm, "AccentColor", abgr);
                Dword(Dwm, "ColorizationColor", argb);
                Dword(Dwm, "ColorizationAfterglow", argb);
                // stop Windows from picking the accent out of the wallpaper again
                using (var k = Registry.CurrentUser.CreateSubKey(Desktop)) k.SetValue("AutoColorization", 0, RegistryValueKind.DWord);
                res["immersive"] = Immersive(ColorRef(shades[3]), before);
                done.Add("акцент");
            }
            var selHex = c.TryGetValue("highlight", out var hv) ? Convert.ToString(hv) : "";
            if (!string.IsNullOrEmpty(selHex))
            {
                var hotHex = c.TryGetValue("hot", out var hh) ? Convert.ToString(hh) : selHex;
                Rgb(selHex, out var r1, out var g1, out var b1);
                Rgb(hotHex, out var r2, out var g2, out var b2);
                using (var k = Registry.CurrentUser.CreateSubKey(Colors))
                {
                    k.SetValue("Hilight", r1 + " " + g1 + " " + b1, RegistryValueKind.String);
                    k.SetValue("HotTrackingColor", r2 + " " + g2 + " " + b2, RegistryValueKind.String);
                }
                Native.SetSysColors(2, new[] { 13, 26 }, new[] { (int)ColorRef(selHex), (int)ColorRef(hotHex) });
                done.Add("выделение");
            }
            var dark = Program.Bool(c, "dark");
            if (dark.HasValue)
            {
                uint light = dark.Value ? 0u : 1u;
                Dword(Personalize, "AppsUseLightTheme", light);
                Dword(Personalize, "SystemUsesLightTheme", light);
                done.Add(dark.Value ? "тёмная тема" : "светлая тема");
            }
            var prev = Program.Bool(c, "prevalence");
            if (prev.HasValue)
            {
                Dword(Personalize, "ColorPrevalence", prev.Value ? 1u : 0u);
                Dword(Dwm, "ColorPrevalence", prev.Value ? 1u : 0u);
                done.Add(prev.Value ? "акцент на панелях" : "без акцента на панелях");
            }
            Broadcast();
            // read back, so the log shows what Windows really keeps
            using (var k = Registry.CurrentUser.OpenSubKey(Dwm))
            {
                var v = k == null ? null : k.GetValue("AccentColor");
                if (v is int iv) res["accentNow"] = "0x" + unchecked((uint)iv).ToString("x8");
            }
            res["highlightNow"] = "0x" + Native.GetSysColor(13).ToString("x6");
            res["done"] = string.Join(", ", done);
            res["ok"] = true;
            return res;
        }

        // Tell every window (Explorer, the taskbar, Start, open apps) that colours changed.
        private static void Broadcast()
        {
            var b = new IntPtr(0xFFFF);
            Native.SendMessageTimeoutStr(b, 0x001A /* WM_SETTINGCHANGE */, IntPtr.Zero, "ImmersiveColorSet", 0x2 /* SMTO_ABORTIFHUNG */, 400, out _);
            Native.SendMessageTimeoutStr(b, 0x001A, IntPtr.Zero, "WindowsThemeElement", 0x2, 400, out _);
            Native.SendMessageTimeout(b, 0x0320 /* WM_DWMCOLORIZATIONCOLORCHANGED */, IntPtr.Zero, IntPtr.Zero, 0x2, 400, out _);
        }

        // ----- the accent as Settings sets it (applies at once, no sign-out) -----

        [StructLayout(LayoutKind.Sequential)]
        private struct ColorPref
        {
            public uint Set1;
            public uint Set2;
        }

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int PrefFn(ref ColorPref p, [MarshalAs(UnmanagedType.Bool)] bool force);

        private static PrefFn _get, _set;
        private static string _how;

        private static string Guard()
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rezonans");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "immersive-try");
        }

        private static void Resolve()
        {
            if (_how != null) return;
            _how = "none";
            try
            {
                var ux = Native.LoadLibrary("uxtheme.dll");
                if (ux == IntPtr.Zero) return;
                var g = Native.GetProcAddress(ux, "GetUserColorPreference");
                var s = Native.GetProcAddress(ux, "SetUserColorPreference");
                if (g != IntPtr.Zero && s != IntPtr.Zero)
                {
                    _how = "name";
                }
                else
                {
                    // older builds export them by number only. A crash while trying them
                    // leaves the marker file behind: then they are never used again.
                    if (File.Exists(Guard()) && File.ReadAllText(Guard()).Trim() == "try")
                    {
                        _how = "disabled";
                        return;
                    }
                    g = Native.GetProcAddressOrd(ux, new IntPtr(120));
                    s = Native.GetProcAddressOrd(ux, new IntPtr(122));
                    if (g == IntPtr.Zero || s == IntPtr.Zero) return;
                    _how = "ordinal";
                }
                _get = (PrefFn)Marshal.GetDelegateForFunctionPointer(g, typeof(PrefFn));
                _set = (PrefFn)Marshal.GetDelegateForFunctionPointer(s, typeof(PrefFn));
            }
            catch (Exception e)
            {
                _how = "error: " + e.Message;
            }
        }

        internal static string ImmersiveInfo()
        {
            Resolve();
            return _how;
        }

        // the accent Windows keeps now, as 0x00BBGGRR (0 when unknown)
        private static uint CurrentAccent()
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(Dwm))
                {
                    var cur = k == null ? null : k.GetValue("AccentColor");
                    return cur is int ci ? unchecked((uint)ci) & 0xFFFFFF : 0;
                }
            }
            catch
            {
                return 0;
            }
        }

        private static string Immersive(uint colorRef, uint before)
        {
            Resolve();
            if (_get == null || _set == null) return _how;
            var guard = _how == "ordinal" ? Guard() : null;
            try
            {
                if (guard != null) File.WriteAllText(guard, "try");
                var p = new ColorPref();
                var hr = _get(ref p, false);
                if (hr != 0) return _how + ": чтение 0x" + hr.ToString("x");
                // only if what it reads looks like an accent Windows had: the old one
                // or the one just written
                var seen = p.Set2 & 0xFFFFFF;
                if (seen != before && seen != (colorRef & 0xFFFFFF))
                {
                    if (guard != null) File.WriteAllText(guard, "skip");
                    return _how + ": не похоже (0x" + seen.ToString("x6") + " / 0x" + before.ToString("x6") + "), пропущено";
                }
                p.Set2 = (p.Set2 & 0xFF000000) | (colorRef & 0xFFFFFF);
                hr = _set(ref p, true);
                if (guard != null) File.WriteAllText(guard, "ok");
                return _how + (hr == 0 ? ": ok" : ": 0x" + hr.ToString("x"));
            }
            catch (Exception e)
            {
                if (guard != null) try { File.WriteAllText(guard, "error"); } catch { }
                return _how + ": " + e.Message;
            }
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
        internal const uint ABE_TOP = 1, ABE_BOTTOM = 3;

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
        [DllImport("dwmapi.dll")] internal static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int v, int size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageTimeoutW")] internal static extern IntPtr SendMessageTimeoutStr(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] internal static extern uint GetSysColor(int index);
        [DllImport("user32.dll")] internal static extern bool SetSysColors(int count, int[] elements, int[] colors);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] internal static extern IntPtr LoadLibrary(string name);
        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] internal static extern IntPtr GetProcAddress(IntPtr h, string name);
        [DllImport("kernel32.dll", EntryPoint = "GetProcAddress", ExactSpelling = true)] internal static extern IntPtr GetProcAddressOrd(IntPtr h, IntPtr ordinal);
    }
}
