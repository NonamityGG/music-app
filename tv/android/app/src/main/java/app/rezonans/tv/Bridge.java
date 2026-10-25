package app.rezonans.tv;

import android.Manifest;
import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** What the page can ask of the TV: window.RezTV.* (strings in, strings out). */
final class Bridge {
    private final MainActivity a;
    private final Map<String, ComponentName> components = new HashMap<>();

    Bridge(MainActivity a) {
        this.a = a;
    }

    // ---------- apps ----------

    /** Every app that can be opened: TV apps first-class, phone-style apps too. */
    @JavascriptInterface
    public String apps() {
        PackageManager pm = a.getPackageManager();
        JSONArray out = new JSONArray();
        Map<String, Boolean> seen = new HashMap<>();
        synchronized (components) {
            components.clear();
            collect(pm, Intent.CATEGORY_LEANBACK_LAUNCHER, true, out, seen);
            collect(pm, Intent.CATEGORY_LAUNCHER, false, out, seen);
        }
        return out.toString();
    }

    private void collect(PackageManager pm, String category, boolean tv, JSONArray out, Map<String, Boolean> seen) {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(category);
        List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
        if (list == null) return;
        for (ResolveInfo ri : list) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(a.getPackageName()) || seen.containsKey(pkg)) continue;
            seen.put(pkg, true);
            ApplicationInfo ai = ri.activityInfo.applicationInfo;
            try {
                JSONObject o = new JSONObject();
                o.put("pkg", pkg);
                o.put("label", String.valueOf(ri.loadLabel(pm)));
                o.put("tv", tv);
                o.put("banner", ri.activityInfo.banner != 0 || (ai != null && ai.banner != 0));
                o.put("sys", ai != null && (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                try {
                    PackageInfo pi = pm.getPackageInfo(pkg, 0);
                    o.put("installed", pi.firstInstallTime);
                } catch (Exception ignored) {
                }
                out.put(o);
                components.put(pkg, new ComponentName(pkg, ri.activityInfo.name));
            } catch (Exception ignored) {
            }
        }
    }

    @JavascriptInterface
    public boolean launch(String pkg) {
        try {
            ComponentName cn;
            synchronized (components) {
                cn = components.get(pkg);
            }
            Intent i;
            if (cn != null) {
                i = new Intent(Intent.ACTION_MAIN).setComponent(cn);
                i.addCategory(Intent.CATEGORY_LAUNCHER);
            } else {
                PackageManager pm = a.getPackageManager();
                i = Build.VERSION.SDK_INT >= 21 ? pm.getLeanbackLaunchIntentForPackage(pkg) : null;
                if (i == null) i = pm.getLaunchIntentForPackage(pkg);
            }
            if (i == null) return false;
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            a.startActivity(i);
            return true;
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "launch " + pkg + ": " + e);
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
        Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
        return start(i);
    }

    @JavascriptInterface
    public boolean openAccessibility() {
        return start(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
    }

    // ---------- setting up on the TV itself, without a computer ----------

    /** Asks for the sound (the waves hear what the TV plays): the system's own question. */
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

    @JavascriptInterface
    public boolean openHomeSettings() {
        return start(new Intent(Settings.ACTION_HOME_SETTINGS)) || start(new Intent("android.settings.MANAGE_DEFAULT_APPS_SETTINGS"));
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

    // ---------- the box ----------

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
            if (Build.VERSION.SDK_INT >= 26) {
                PackageInfo wv = WebView.getCurrentWebViewPackage();
                if (wv != null) o.put("webview", wv.packageName + " " + wv.versionName);
            }
            o.put("home", isDefaultHome());
            o.put("guard", HomeGuard.enabled(a));
            o.put("guardOn", Prefs.guard(a));
            o.put("notif", MediaHub.listenerEnabled(a));
            o.put("mic", Build.VERSION.SDK_INT < 23 || a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
            ComponentName stock = HomeGuard.stockHome(a);
            if (stock != null) {
                o.put("stock", stock.getPackageName());
                try {
                    o.put("stockLabel", String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(stock.getPackageName(), 0))));
                } catch (Exception ignored) {
                }
            }
            ActivityManager am = (ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                o.put("ram", mi.totalMem / (1024 * 1024));
                o.put("ramFree", mi.availMem / (1024 * 1024));
                o.put("lowRam", am.isLowRamDevice());
            }
            o.put("ip", ip());
            o.put("net", network());
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "info: " + e);
        }
        return o.toString();
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
            return "other";
        } catch (Exception e) {
            return "other";
        }
    }

    private static String ip() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress ad : Collections.list(ni.getInetAddresses())) {
                    if (ad instanceof Inet4Address && ad.isSiteLocalAddress()) return ad.getHostAddress();
                }
            }
        } catch (Exception ignored) {
        }
        return "";
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
        a.ui.post(() -> {
            if (on && a.isVisible()) Viz.resume(a);
            else Viz.stop();
        });
    }

    // ---------- the Home button ----------

    @JavascriptInterface
    public void setGuard(boolean on) {
        Prefs.set(a, "guard", on);
    }

    /** Opens the box's own home screen; Резонанс OS doesn't take it back for a while. */
    @JavascriptInterface
    public boolean openStockHome(int minutes) {
        Prefs.pause(a, minutes);
        ComponentName stock = HomeGuard.stockHome(a);
        if (stock == null) return false;
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setComponent(stock);
        return start(i);
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
