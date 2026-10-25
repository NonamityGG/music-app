package app.rezonans.tv;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.util.Log;

/**
 * Which screen saver the box starts when it's left alone. Changing it needs
 * WRITE_SECURE_SETTINGS, which only adb can give (the installer does); the
 * box's own saver is remembered and given back when switched off.
 */
final class SystemSaver {
    private static final String COMPONENTS = "screensaver_components";
    private static final String ENABLED = "screensaver_enabled";

    private SystemSaver() {
    }

    static String ours(Context c) {
        return new ComponentName(c, Dream.class).flattenToString();
    }

    static boolean allowed(Context c) {
        return c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED;
    }

    static String current(Context c) {
        try {
            String v = Settings.Secure.getString(c.getContentResolver(), COMPONENTS);
            return v == null ? "" : v;
        } catch (Exception e) {
            return "";
        }
    }

    static boolean isOurs(Context c) {
        return current(c).contains(c.getPackageName() + "/");
    }

    /** true when done. */
    static boolean set(Context c, boolean on) {
        if (!allowed(c)) return false;
        try {
            android.content.SharedPreferences p = c.getSharedPreferences("rez", Context.MODE_PRIVATE);
            if (on) {
                if (!isOurs(c)) p.edit().putString("saverBefore", current(c)).apply();
                Settings.Secure.putString(c.getContentResolver(), COMPONENTS, ours(c));
                Settings.Secure.putInt(c.getContentResolver(), ENABLED, 1);
            } else {
                String before = p.getString("saverBefore", "");
                if (before.contains(c.getPackageName() + "/")) before = "";
                Settings.Secure.putString(c.getContentResolver(), COMPONENTS, before);
            }
            Log.i(MainActivity.TAG, "заставка системы: " + current(c));
            return true;
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "заставка системы: " + e);
            return false;
        }
    }
}
