package app.rezonans.launcher;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.util.LruCache;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * App icons as PNG, without the system's shape: an adaptive icon is drawn as
 * its two layers filling the whole square (the page cuts it into the shape the
 * person chose), the "themed" silhouette of Android 13 comes separately, and
 * every icon brings its main colour (for plates, folders and the light).
 */
final class Icons {
    static final int S = 192;
    private static final LruCache<String, byte[]> cache = new LruCache<String, byte[]>(14 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, byte[] value) {
            return value.length;
        }
    };
    private static final ConcurrentHashMap<String, String> metas = new ConcurrentHashMap<>();

    private Icons() {
    }

    static void forget(String pkg) {
        if (pkg == null) {
            cache.evictAll();
            metas.clear();
            return;
        }
        cache.remove(pkg + "|i");
        cache.remove(pkg + "|m");
        metas.remove(pkg);
    }

    static ComponentName launcher(PackageManager pm, String pkg) {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(pkg);
        List<ResolveInfo> l = pm.queryIntentActivities(i, 0);
        if (l == null || l.isEmpty()) return null;
        return new ComponentName(pkg, l.get(0).activityInfo.name);
    }

    private static Drawable drawable(Context c, String pkg) {
        PackageManager pm = c.getPackageManager();
        try {
            ComponentName cn = launcher(pm, pkg);
            Drawable d = cn != null ? pm.getActivityIcon(cn) : null;
            return d != null ? d : pm.getApplicationIcon(pkg);
        } catch (Exception e) {
            return null;
        }
    }

    /** PNG of the icon (mono: the one-colour silhouette for themed icons, or null if the app has none). */
    static byte[] get(Context c, String pkg, boolean mono) {
        String key = pkg + (mono ? "|m" : "|i");
        byte[] hit = cache.get(key);
        if (hit != null) return hit;
        if (mono && "0".equals(metaFlag(pkg, 'm'))) return null;
        try {
            build(c, pkg);
            return cache.get(key);
        } catch (Throwable e) {
            return null;
        }
    }

    /** {"a":1,"m":1,"c":"#rrggbb"} — adaptive, has a themed silhouette, main colour. */
    static String meta(Context c, String pkg) {
        String m = metas.get(pkg);
        if (m != null) return m;
        try {
            build(c, pkg);
        } catch (Throwable ignored) {
        }
        m = metas.get(pkg);
        return m != null ? m : "{}";
    }

    private static String metaFlag(String pkg, char which) {
        String m = metas.get(pkg);
        if (m == null) return null;
        return m.contains("\"" + which + "\":1") ? "1" : "0";
    }

    private static synchronized void build(Context c, String pkg) throws Exception {
        if (metas.containsKey(pkg) && cache.get(pkg + "|i") != null) return;
        Drawable d = drawable(c, pkg);
        if (d == null) return;
        boolean adaptive = false;
        boolean hasMono = false;
        Bitmap main = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(main);
        if (Build.VERSION.SDK_INT >= 26 && d instanceof AdaptiveIconDrawable) {
            adaptive = true;
            AdaptiveIconDrawable ad = (AdaptiveIconDrawable) d;
            layer(cv, ad.getBackground());
            layer(cv, ad.getForeground());
            if (Build.VERSION.SDK_INT >= 33 && ad.getMonochrome() != null) {
                Bitmap mb = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888);
                layer(new Canvas(mb), ad.getMonochrome());
                cache.put(pkg + "|m", png(mb));
                hasMono = true;
            }
        } else {
            fit(cv, d);
        }
        cache.put(pkg + "|i", png(main));
        JSONObject o = new JSONObject();
        o.put("a", adaptive ? 1 : 0);
        o.put("m", hasMono ? 1 : 0);
        int col = dominant(main);
        if (col != 0) o.put("c", String.format("#%06x", col & 0xFFFFFF));
        metas.put(pkg, o.toString());
    }

    // an adaptive icon's layers are 108 dp, the visible window is the middle 72 dp
    private static void layer(Canvas cv, Drawable l) {
        if (l == null) return;
        l.setBounds(-S / 4, -S / 4, S + S / 4, S + S / 4);
        l.draw(cv);
    }

    private static void fit(Canvas cv, Drawable d) {
        int iw = d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : S;
        int ih = d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : S;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
            iw = ((BitmapDrawable) d).getBitmap().getWidth();
            ih = ((BitmapDrawable) d).getBitmap().getHeight();
        }
        float k = Math.min((float) S / iw, (float) S / ih);
        int w = Math.max(1, Math.round(iw * k));
        int h = Math.max(1, Math.round(ih * k));
        int x = (S - w) / 2;
        int y = (S - h) / 2;
        d.setBounds(x, y, x + w, y + h);
        d.draw(cv);
    }

    private static byte[] png(Bitmap b) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, out);
        return out.toByteArray();
    }

    // the most vivid hue of the icon (the same idea as the TV's: saturated, not too dark or light)
    private static int dominant(Bitmap src) {
        try {
            int n = 24;
            Bitmap sm = Bitmap.createScaledBitmap(src, n, n, true);
            float[] hsv = new float[3];
            float[] w = new float[12];
            float[] hs = new float[12];
            float[] ss = new float[12];
            for (int y = 0; y < n; y++) {
                for (int x = 0; x < n; x++) {
                    int p = sm.getPixel(x, y);
                    if (Color.alpha(p) < 128) continue;
                    Color.colorToHSV(p, hsv);
                    float s = hsv[1];
                    float v = hsv[2];
                    if (v < 0.18f || s < 0.22f) continue;
                    int k = Math.round(hsv[0] / 30f) % 12;
                    float wt = s * s * (0.4f + 0.6f * v);
                    w[k] += wt;
                    hs[k] += hsv[0] * wt;
                    ss[k] += s * wt;
                }
            }
            int best = -1;
            for (int k = 0; k < 12; k++) if (best < 0 || w[k] > w[best]) best = k;
            if (best < 0 || w[best] < 0.8f) return 0;
            float[] out = {hs[best] / w[best], Math.min(1f, Math.max(0.55f, ss[best] / w[best] * 1.1f)), 0.95f};
            return Color.HSVToColor(out) & 0xFFFFFF;
        } catch (Throwable e) {
            return 0;
        }
    }
}
