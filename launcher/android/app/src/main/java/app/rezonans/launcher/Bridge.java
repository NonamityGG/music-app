package app.rezonans.launcher;

import android.Manifest;
import android.app.ActivityManager;
import android.app.ActivityOptions;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.LauncherApps;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ShortcutInfo;
import android.content.res.Configuration;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** What the page can ask of the phone: window.RezL.* (strings in, strings out). */
final class Bridge {
    private final MainActivity a;
    private final Map<String, ComponentName> components = new HashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String metaSig = "";

    Bridge(MainActivity a) {
        this.a = a;
    }

    // ---------- apps ----------

    /** Every app with a launcher icon. Icons' colours follow later (event "meta"). */
    @JavascriptInterface
    public String apps() {
        PackageManager pm = a.getPackageManager();
        JSONArray out = new JSONArray();
        Map<String, Boolean> seen = new HashMap<>();
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
        StringBuilder sig = new StringBuilder();
        synchronized (components) {
            components.clear();
            if (list != null) {
                for (ResolveInfo ri : list) {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(a.getPackageName()) || seen.containsKey(pkg)) continue;
                    seen.put(pkg, true);
                    ApplicationInfo ai = ri.activityInfo.applicationInfo;
                    try {
                        JSONObject o = new JSONObject();
                        o.put("pkg", pkg);
                        o.put("label", String.valueOf(ri.loadLabel(pm)));
                        o.put("sys", ai != null && (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                        o.put("cat", category(ai));
                        try {
                            PackageInfo pi = pm.getPackageInfo(pkg, 0);
                            o.put("installed", pi.firstInstallTime);
                            o.put("updated", pi.lastUpdateTime);
                        } catch (Exception ignored) {
                        }
                        out.put(o);
                        components.put(pkg, new ComponentName(pkg, ri.activityInfo.name));
                        sig.append(pkg).append(';');
                    } catch (Exception ignored) {
                    }
                }
            }
        }
        primeIcons(sig.toString());
        return out.toString();
    }

    // 0 game, 1 audio, 2 video, 3 image, 4 social, 5 news, 6 maps, 7 productivity, -1 unknown
    private static int category(ApplicationInfo ai) {
        if (ai == null) return -1;
        if (Build.VERSION.SDK_INT >= 26) {
            switch (ai.category) {
                case ApplicationInfo.CATEGORY_GAME: return 0;
                case ApplicationInfo.CATEGORY_AUDIO: return 1;
                case ApplicationInfo.CATEGORY_VIDEO: return 2;
                case ApplicationInfo.CATEGORY_IMAGE: return 3;
                case ApplicationInfo.CATEGORY_SOCIAL: return 4;
                case ApplicationInfo.CATEGORY_NEWS: return 5;
                case ApplicationInfo.CATEGORY_MAPS: return 6;
                case ApplicationInfo.CATEGORY_PRODUCTIVITY: return 7;
                default: return -1;
            }
        }
        return (ai.flags & ApplicationInfo.FLAG_IS_GAME) != 0 ? 0 : -1;
    }

    // icons are drawn once in the background; the page gets each one's colour and kind
    private void primeIcons(String sig) {
        if (sig.equals(metaSig)) return;
        metaSig = sig;
        final String[] pkgs = sig.split(";");
        worker.execute(() -> {
            try {
                JSONObject all = new JSONObject();
                for (String pkg : pkgs) {
                    if (pkg.isEmpty()) continue;
                    all.put(pkg, new JSONObject(Icons.meta(a, pkg)));
                }
                Prefs.putStr(a, "meta", all.toString());
                a.emit("meta", all.toString());
            } catch (Exception e) {
                Log.w(MainActivity.TAG, "icons: " + e);
            }
        });
    }

    /** The colours and kinds of icons from the last time (so the first picture is already right). */
    @JavascriptInterface
    public String meta() {
        return Prefs.str(a, "meta", "{}");
    }

    /** Opens an app; the window grows out of the icon (x, y, w, h in CSS pixels). */
    @JavascriptInterface
    public boolean launch(String pkg, float x, float y, float w, float h) {
        try {
            ComponentName cn;
            synchronized (components) {
                cn = components.get(pkg);
            }
            Intent i;
            if (cn != null) {
                i = new Intent(Intent.ACTION_MAIN).setComponent(cn).addCategory(Intent.CATEGORY_LAUNCHER);
            } else {
                i = a.getPackageManager().getLaunchIntentForPackage(pkg);
            }
            if (i == null) return false;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            float d = a.getResources().getDisplayMetrics().density;
            if (w > 0 && h > 0 && a.web != null) {
                ActivityOptions o = ActivityOptions.makeScaleUpAnimation(a.web, Math.round(x * d), Math.round(y * d), Math.round(w * d), Math.round(h * d));
                a.startActivity(i, o.toBundle());
            } else {
                a.startActivity(i);
            }
            return true;
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "launch " + pkg + ": " + e);
            return false;
        }
    }

    /** The app's own shortcuts (long press on an icon): [{"id","label"}]. Only when we are the home app. */
    @JavascriptInterface
    public String shortcuts(String pkg) {
        JSONArray out = new JSONArray();
        if (Build.VERSION.SDK_INT < 25) return out.toString();
        try {
            LauncherApps la = (LauncherApps) a.getSystemService(Context.LAUNCHER_APPS_SERVICE);
            if (la == null || !la.hasShortcutHostPermission()) return out.toString();
            LauncherApps.ShortcutQuery q = new LauncherApps.ShortcutQuery();
            q.setPackage(pkg);
            q.setQueryFlags(LauncherApps.ShortcutQuery.FLAG_MATCH_DYNAMIC | LauncherApps.ShortcutQuery.FLAG_MATCH_MANIFEST | LauncherApps.ShortcutQuery.FLAG_MATCH_PINNED);
            List<ShortcutInfo> list = la.getShortcuts(q, Process.myUserHandle());
            if (list != null) {
                for (ShortcutInfo s : list) {
                    if (!s.isEnabled()) continue;
                    CharSequence label = s.getShortLabel();
                    if (label == null) continue;
                    JSONObject o = new JSONObject();
                    o.put("id", s.getId());
                    o.put("label", label.toString());
                    out.put(o);
                    if (out.length() >= 5) break;
                }
            }
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "shortcuts " + pkg + ": " + e);
        }
        return out.toString();
    }

    @JavascriptInterface
    public boolean startShortcut(String pkg, String id) {
        if (Build.VERSION.SDK_INT < 25) return false;
        try {
            LauncherApps la = (LauncherApps) a.getSystemService(Context.LAUNCHER_APPS_SERVICE);
            la.startShortcut(pkg, id, null, null, Process.myUserHandle());
            return true;
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "shortcut " + pkg + "/" + id + ": " + e);
            return false;
        }
    }

    @JavascriptInterface
    public boolean openSettings() {
        return start(new Intent(Settings.ACTION_SETTINGS));
    }

    @JavascriptInterface
    public boolean appInfo(String pkg) {
        return start(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)));
    }

    @JavascriptInterface
    public boolean uninstall(String pkg) {
        return start(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg)));
    }

    /** A web address in the browser (searches and links). */
    @JavascriptInterface
    public boolean openUrl(String url) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return false;
        return start(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    private boolean start(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ---------- setting up ----------

    @JavascriptInterface
    public boolean requestMic() {
        if (Build.VERSION.SDK_INT < 23) return false;
        a.ui.post(() -> a.requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, 7));
        return true;
    }

    @JavascriptInterface
    public boolean openNotificationAccess() {
        return start(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"));
    }

    /** The system's "default home app" choice (Резонанс becomes the one the Home button opens). */
    @JavascriptInterface
    public boolean openHomeSettings() {
        return start(new Intent(Settings.ACTION_HOME_SETTINGS)) || start(new Intent("android.settings.MANAGE_DEFAULT_APPS_SETTINGS")) || start(new Intent(Settings.ACTION_SETTINGS));
    }

    // ---------- the phone ----------

    @JavascriptInterface
    public String info() {
        JSONObject o = new JSONObject();
        try {
            PackageManager pm = a.getPackageManager();
            o.put("app", pm.getPackageInfo(a.getPackageName(), 0).versionName);
            o.put("model", Build.MODEL);
            o.put("maker", Build.MANUFACTURER);
            o.put("android", Build.VERSION.RELEASE);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("dp", a.getResources().getDisplayMetrics().density);
            o.put("sw", a.getResources().getConfiguration().smallestScreenWidthDp);
            o.put("tablet", a.getResources().getConfiguration().smallestScreenWidthDp >= 600);
            o.put("home", isDefaultHome());
            o.put("notif", MediaHub.listenerEnabled(a));
            o.put("mic", Build.VERSION.SDK_INT < 23 || a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
            o.put("dark", (a.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES);
            ActivityManager am = (ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                o.put("ram", mi.totalMem / (1024 * 1024));
                o.put("lowRam", am.isLowRamDevice());
            }
            // the bars and the cut-out: what the page has missed before it was loaded
            if (a.lastInsets != null && !a.lastInsets.isEmpty()) o.put("insets", new JSONObject(a.lastInsets));
            // Material You colours (Android 12+): the phone's own accent, as three shades
            if (Build.VERSION.SDK_INT >= 31) {
                JSONArray y = new JSONArray();
                y.put(hex(a.getColor(android.R.color.system_accent1_500)));
                y.put(hex(a.getColor(android.R.color.system_accent1_200)));
                y.put(hex(a.getColor(android.R.color.system_accent2_300)));
                o.put("you", y);
            }
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "info: " + e);
        }
        return o.toString();
    }

    private static String hex(int c) {
        return String.format("#%06x", c & 0xFFFFFF);
    }

    private boolean isDefaultHome() {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo ri = a.getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
        return ri != null && ri.activityInfo != null && a.getPackageName().equals(ri.activityInfo.packageName);
    }

    @JavascriptInterface
    public String network() {
        try {
            ConnectivityManager cm = (ConnectivityManager) a.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo n = cm != null ? cm.getActiveNetworkInfo() : null;
            if (n == null || !n.isConnected()) return "none";
            if (n.getType() == ConnectivityManager.TYPE_WIFI) return "wifi";
            if (n.getType() == ConnectivityManager.TYPE_ETHERNET) return "eth";
            return "mobile";
        } catch (Exception e) {
            return "other";
        }
    }

    /** {"level":0..100,"charging":bool} */
    @JavascriptInterface
    public String battery() {
        try {
            Intent b = a.registerReceiver(null, new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b == null) return "{}";
            int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            JSONObject o = new JSONObject();
            o.put("level", scale > 0 ? Math.round(level * 100f / scale) : -1);
            o.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public String badges() {
        return MediaListener.badges();
    }

    // ---------- what's playing ----------

    @JavascriptInterface
    public String mediaState() {
        return MediaHub.json();
    }

    @JavascriptInterface
    public void media(String action) {
        MediaHub.action(action);
    }

    @JavascriptInterface
    public void visualizer(boolean on) {
        Prefs.set(a, "viz", on);
        a.ui.post(() -> Viz.resume(a));
    }

    // ---------- the screen and the touch ----------

    /** tick, press, context, confirm: a short vibration of the screen. */
    @JavascriptInterface
    public void haptic(String kind) {
        a.ui.post(() -> {
            if (a.web == null) return;
            int c = HapticFeedbackConstants.LONG_PRESS;
            if ("tick".equals(kind)) c = Build.VERSION.SDK_INT >= 21 ? HapticFeedbackConstants.CLOCK_TICK : HapticFeedbackConstants.VIRTUAL_KEY;
            else if ("context".equals(kind) && Build.VERSION.SDK_INT >= 23) c = HapticFeedbackConstants.CONTEXT_CLICK;
            else if ("confirm".equals(kind) && Build.VERSION.SDK_INT >= 30) c = HapticFeedbackConstants.CONFIRM;
            a.web.performHapticFeedback(c);
        });
    }

    /** Pulls down the notification shade (swipe down on the home screen). */
    @JavascriptInterface
    public boolean notifications() {
        try {
            Object sb = a.getSystemService("statusbar");
            if (sb == null) return false;
            Class<?> k = Class.forName("android.app.StatusBarManager");
            k.getMethod(Build.VERSION.SDK_INT >= 17 ? "expandNotificationsPanel" : "expand").invoke(sb);
            return true;
        } catch (Throwable e) {
            Log.w(MainActivity.TAG, "shade: " + e);
            return false;
        }
    }

    /** auto (follows the phone) or portrait. */
    @JavascriptInterface
    public void orientation(String mode) {
        a.ui.post(() -> a.setRequestedOrientation("portrait".equals(mode)
            ? android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            : android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
    }

    // ---------- keeping the settings ----------

    /** The copy of the page's layout and settings that survives the page's storage being cleared. */
    @JavascriptInterface
    public String storeGet() {
        return Prefs.str(a, "store", "");
    }

    @JavascriptInterface
    public void storeSet(String json) {
        Prefs.putStr(a, "store", json);
    }

    // ---------- misc ----------

    @JavascriptInterface
    public void log(String msg) {
        Log.i(MainActivity.TAG, "page: " + msg);
    }

    @JavascriptInterface
    public void reload() {
        a.ui.post(() -> {
            if (a.web != null) a.web.reload();
        });
    }
}
