package app.rezonans.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.util.LruCache;

import java.io.ByteArrayOutputStream;
import java.util.List;

/** App banners (16:9, what TV apps show in launchers) and icons as PNG. */
final class Icons {
    private static final LruCache<String, byte[]> cache = new LruCache<String, byte[]>(12 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, byte[] value) {
            return value.length;
        }
    };

    private Icons() {
    }

    static void forget(String pkg) {
        if (pkg == null) {
            cache.evictAll();
            return;
        }
        cache.remove(pkg + "|b");
        cache.remove(pkg + "|i");
    }

    static byte[] get(Context c, String pkg, boolean banner) {
        String key = pkg + (banner ? "|b" : "|i");
        byte[] hit = cache.get(key);
        if (hit != null) return hit;
        try {
            PackageManager pm = c.getPackageManager();
            Drawable d = null;
            if (banner) {
                ComponentName tv = leanback(pm, pkg);
                if (tv != null) d = pm.getActivityBanner(tv);
                if (d == null) d = pm.getApplicationBanner(pkg);
                if (d == null) return null;
            } else {
                ComponentName tv = leanback(pm, pkg);
                if (tv != null) d = pm.getActivityIcon(tv);
                if (d == null) d = pm.getApplicationIcon(pkg);
            }
            byte[] png = banner ? toPng(d, 480, 270) : toPng(d, 192, 192);
            cache.put(key, png);
            return png;
        } catch (Exception e) {
            return null;
        }
    }

    static ComponentName leanback(PackageManager pm, String pkg) {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER).setPackage(pkg);
        List<ResolveInfo> l = pm.queryIntentActivities(i, 0);
        if (l == null || l.isEmpty()) return null;
        return new ComponentName(pkg, l.get(0).activityInfo.name);
    }

    static byte[] toPng(Drawable d, int w, int h) {
        Bitmap b;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
            Bitmap src = ((BitmapDrawable) d).getBitmap();
            // keep the picture's own proportions, only make big ones smaller
            float k = Math.min(1f, Math.max((float) w / src.getWidth(), (float) h / src.getHeight()));
            b = k < 1f ? Bitmap.createScaledBitmap(src, Math.round(src.getWidth() * k), Math.round(src.getHeight() * k), true) : src;
        } else {
            int iw = d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : w;
            int ih = d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : h;
            float k = Math.max((float) w / iw, (float) h / ih);
            int bw = Math.max(1, Math.round(iw * k));
            int bh = Math.max(1, Math.round(ih * k));
            b = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(b);
            d.setBounds(0, 0, bw, bh);
            d.draw(cv);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, out);
        return out.toByteArray();
    }
}
