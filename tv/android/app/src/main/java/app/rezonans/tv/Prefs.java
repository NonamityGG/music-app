package app.rezonans.tv;

import android.content.Context;
import android.content.SharedPreferences;

/** The few settings the Android side needs itself (the page keeps the rest). */
final class Prefs {
    private Prefs() {
    }

    private static SharedPreferences p(Context c) {
        return c.getSharedPreferences("rez", Context.MODE_PRIVATE);
    }

    static boolean guard(Context c) {
        return p(c).getBoolean("guard", true);
    }

    static boolean viz(Context c) {
        return p(c).getBoolean("viz", true);
    }

    static void set(Context c, String key, boolean v) {
        p(c).edit().putBoolean(key, v).apply();
    }

    static void pause(Context c, int minutes) {
        p(c).edit().putLong("pausedUntil", System.currentTimeMillis() + Math.max(0, minutes) * 60000L).apply();
    }

    static boolean paused(Context c) {
        return p(c).getLong("pausedUntil", 0) > System.currentTimeMillis();
    }

    static void unpause(Context c) {
        p(c).edit().putLong("pausedUntil", 0).apply();
    }
}
