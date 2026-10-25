package app.rezonans.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;

import java.util.List;

/**
 * Some boxes keep their own home screen on the Home button whatever app is
 * chosen. This service notices when that home screen comes to the front and
 * brings Резонанс OS instead. It only looks at which screen opened (package and
 * screen name of the box's home), never at what is on it.
 */
public class HomeGuard extends AccessibilityService {
    private static ComponentName stock;
    private static long stockAt;
    private long lastJump;

    static boolean enabled(Context c) {
        String s = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return s != null && s.contains(c.getPackageName() + "/");
    }

    /** The box's own home screen (any HOME screen that isn't ours or a stub). */
    static synchronized ComponentName stockHome(Context c) {
        long now = SystemClock.elapsedRealtime();
        if (stock != null && now - stockAt < 60000) return stock;
        stockAt = now;
        stock = null;
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        List<ResolveInfo> list = c.getPackageManager().queryIntentActivities(i, PackageManager.MATCH_ALL);
        if (list == null) return null;
        ResolveInfo best = null;
        for (ResolveInfo ri : list) {
            String pkg = ri.activityInfo.packageName;
            String cls = ri.activityInfo.name;
            if (pkg.equals(c.getPackageName())) continue;
            if (cls.endsWith("FallbackHome") || pkg.equals("com.android.settings") || pkg.equals("com.android.tv.settings")) continue;
            if (best == null || ri.priority > best.priority) best = ri;
        }
        if (best != null) stock = new ComponentName(best.activityInfo.packageName, best.activityInfo.name);
        return stock;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkg = e.getPackageName();
        CharSequence cls = e.getClassName();
        if (pkg == null || cls == null) return;
        if (!Prefs.guard(this) || Prefs.paused(this)) return;
        ComponentName home = stockHome(this);
        if (home == null || !home.getPackageName().contentEquals(pkg)) return;
        // only the home screen itself, not other screens of the same app
        if (!home.getClassName().contentEquals(cls)) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastJump < 800) return;
        lastJump = now;
        Intent i = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onInterrupt() {
    }
}
