package app.rezonans.player;

import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    static final String PREFS = "rezonans";
    private static final long SPLASH_MAX_MS = 4000;

    private volatile boolean webShown = false;
    private long startedAt;
    private boolean fullscreen = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        startedAt = SystemClock.uptimeMillis();
        registerPlugin(ServiceWebPlugin.class);
        registerPlugin(ScreenPlugin.class);
        super.onCreate(savedInstanceState);

        // full screen from the first frame (the choice is remembered natively, so
        // the layout doesn't jump once the page has loaded)
        fullscreen = getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("fullscreen", true);
        applyFullscreen();
        // Capacitor's own bar plugin shows the bars from a task it queued while
        // starting; apply ours again after it
        new Handler(Looper.getMainLooper()).post(this::applyFullscreen);

        // Keep the system splash (just the intro's background and its point of
        // light) until the page with the intro is on screen, so there is no blank
        // moment between them. The page reports itself through ScreenPlugin.shown().
        final View content = findViewById(android.R.id.content);
        content
            .getViewTreeObserver()
            .addOnPreDrawListener(
                new ViewTreeObserver.OnPreDrawListener() {
                    @Override
                    public boolean onPreDraw() {
                        if (webShown || SystemClock.uptimeMillis() - startedAt > SPLASH_MAX_MS) {
                            content.getViewTreeObserver().removeOnPreDrawListener(this);
                            return true;
                        }
                        return false;
                    }
                }
            );
    }

    void markWebShown() {
        webShown = true;
    }

    void setFullscreen(boolean on) {
        fullscreen = on;
        SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        e.putBoolean("fullscreen", on);
        e.apply();
        applyFullscreen();
    }

    boolean isFullscreen() {
        return fullscreen;
    }

    private void applyFullscreen() {
        Window w = getWindow();
        // the page draws under the bars' places itself (it knows the insets)
        WindowCompat.setDecorFitsSystemWindows(w, !fullscreen && Build.VERSION.SDK_INT < 35);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = fullscreen
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            w.setAttributes(lp);
        }
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
        if (fullscreen) {
            // the bars come back for a moment with a swipe from the edge
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // dialogs, the keyboard or the notification shade can bring the bars back
        if (hasFocus) applyFullscreen();
    }
}
