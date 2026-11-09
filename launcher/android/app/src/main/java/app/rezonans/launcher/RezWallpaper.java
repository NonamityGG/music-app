package app.rezonans.launcher;

import android.graphics.Canvas;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.wallpaper.WallpaperService;
import android.view.Surface;
import android.view.SurfaceHolder;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

/**
 * The live wallpaper: the waves of Резонанс behind the home screen and the
 * lock screen, in the palette chosen in the launcher, sliding with the home
 * pages and following the music. Drawn natively, 30 frames a second by default,
 * and only while it is on the screen.
 */
public class RezWallpaper extends WallpaperService {
    private static final Set<Eng> engines = new HashSet<>();
    private static final Handler main = new Handler(Looper.getMainLooper());

    /** The launcher changed the look: every wallpaper on the screen redraws. */
    static void configChanged() {
        main.post(() -> {
            for (Eng e : new ArrayList<>(engines)) e.reload();
        });
    }

    @Override
    public Engine onCreateEngine() {
        return new Eng();
    }

    private final class Eng extends Engine {
        private final Handler h = new Handler(Looper.getMainLooper());
        private final WaveArt art = new WaveArt(getResources().getDisplayMetrics().density);
        private WaveArt.Cfg cfg = WaveArt.Cfg.parse(Prefs.str(RezWallpaper.this, "wall", null));
        private boolean vis;
        private int w;
        private int ht;
        private float off = 0.5f;
        private final long t0 = SystemClock.uptimeMillis();
        private final Runnable tick = new Runnable() {
            @Override
            public void run() {
                draw();
                if (vis) h.postDelayed(this, 1000L / Math.max(10, cfg.fps));
            }
        };

        @Override
        public void onCreate(SurfaceHolder sh) {
            super.onCreate(sh);
            setTouchEventsEnabled(false);
            engines.add(this);
        }

        @Override
        public void onDestroy() {
            engines.remove(this);
            h.removeCallbacks(tick);
            Viz.wallpaper(RezWallpaper.this, false);
            super.onDestroy();
        }

        @Override
        public void onVisibilityChanged(boolean visible) {
            vis = visible;
            h.removeCallbacks(tick);
            Viz.wallpaper(RezWallpaper.this, visible && cfg.react);
            if (visible) h.post(tick);
        }

        @Override
        public void onSurfaceChanged(SurfaceHolder sh, int format, int width, int height) {
            super.onSurfaceChanged(sh, format, width, height);
            w = width;
            ht = height;
            draw();
        }

        @Override
        public void onSurfaceRedrawNeeded(SurfaceHolder sh) {
            super.onSurfaceRedrawNeeded(sh);
            draw();
        }

        @Override
        public void onOffsetsChanged(float x, float y, float xs, float ys, int xp, int yp) {
            off = x;
        }

        void reload() {
            cfg = WaveArt.Cfg.parse(Prefs.str(RezWallpaper.this, "wall", null));
            Viz.wallpaper(RezWallpaper.this, vis && cfg.react);
            draw();
        }

        private void draw() {
            SurfaceHolder sh = getSurfaceHolder();
            Surface s = sh.getSurface();
            if (s == null || !s.isValid() || w <= 0) return;
            Canvas cv = null;
            boolean hw = Build.VERSION.SDK_INT >= 26;
            try {
                cv = hw ? s.lockHardwareCanvas() : sh.lockCanvas();
                if (cv != null) art.draw(cv, w, ht, (SystemClock.uptimeMillis() - t0) / 1000f, off, Viz.level(), cfg);
            } catch (Throwable ignored) {
                // the surface went away between the check and the lock
            } finally {
                if (cv != null) {
                    try {
                        if (hw) s.unlockCanvasAndPost(cv);
                        else sh.unlockCanvasAndPost(cv);
                    } catch (Throwable ignored) {
                    }
                }
            }
        }
    }
}
