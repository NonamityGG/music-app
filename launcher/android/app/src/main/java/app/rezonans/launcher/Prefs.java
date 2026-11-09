package app.rezonans.launcher;

import android.content.Context;
import android.content.SharedPreferences;

/** The few settings the Android side needs itself (the page keeps the rest, and a copy of it here). */
final class Prefs {
    private Prefs() {
    }

    private static SharedPreferences p(Context c) {
        return c.getSharedPreferences("rez", Context.MODE_PRIVATE);
    }

    static boolean viz(Context c) {
        return p(c).getBoolean("viz", true);
    }

    static void set(Context c, String key, boolean v) {
        p(c).edit().putBoolean(key, v).apply();
    }

    static String str(Context c, String key, String def) {
        return p(c).getString(key, def);
    }

    static void putStr(Context c, String key, String v) {
        p(c).edit().putString(key, v).apply();
    }
}
