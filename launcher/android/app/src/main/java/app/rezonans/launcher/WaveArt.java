package app.rezonans.launcher;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.SweepGradient;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The waves of the live wallpaper, drawn natively: the same look as the page's
 * (a dark base with slow clouds of the palette's colours, a vignette, and the
 * waves — ribbons, capsules, aurora, orb), calm by itself and following the
 * music when something plays. Nothing is allocated per frame.
 */
final class WaveArt {
    static final class Cfg {
        String style = "ribbons";
        String bg = "glass-violet";
        int c1 = 0xFF7C4DFF;
        int c2 = 0xFFC3A6FF;
        int c3 = 0xFFFF6FD8;
        float amp = 1f;
        float speed = 1f;
        boolean react = true;
        int fps = 30;

        static Cfg parse(String json) {
            Cfg c = new Cfg();
            if (json == null || json.isEmpty()) return c;
            try {
                JSONObject o = new JSONObject(json);
                c.style = o.optString("style", c.style);
                c.bg = o.optString("bg", c.bg);
                JSONArray a = o.optJSONArray("c");
                if (a != null && a.length() >= 3) {
                    c.c1 = color(a.optString(0), c.c1);
                    c.c2 = color(a.optString(1), c.c2);
                    c.c3 = color(a.optString(2), c.c3);
                }
                c.amp = clamp((float) o.optDouble("amp", 1), 0.3f, 1.8f);
                c.speed = clamp((float) o.optDouble("speed", 1), 0.3f, 2.5f);
                c.react = o.optBoolean("react", true);
                c.fps = Math.max(10, Math.min(60, o.optInt("fps", 30)));
            } catch (Exception ignored) {
            }
            return c;
        }

        private static int color(String s, int def) {
            try {
                return Color.parseColor(s);
            } catch (Exception e) {
                return def;
            }
        }
    }

    private final float dp;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF rect = new RectF();
    private float energy = 0.4f;
    private final float[] xs = new float[64];
    private final float[] ys = new float[64];
    private final float[] hs = new float[64];

    // shaders are built once per size and colours
    private String key = "";
    private LinearGradient horiz;
    private LinearGradient bgGrad;
    private LinearGradient barGrad;
    private LinearGradient reflGrad;
    private final LinearGradient[] curtain = new LinearGradient[3];
    private RadialGradient vignette;
    private final RadialGradient[] orbs = new RadialGradient[3];
    private SweepGradient sweep;
    private float orbR;

    WaveArt(float density) {
        dp = density;
    }

    private static float clamp(float v, float a, float b) {
        return Math.max(a, Math.min(b, v));
    }

    private static int alpha(int c, float a) {
        return (c & 0x00FFFFFF) | (Math.round(clamp(a, 0, 1) * 255) << 24);
    }

    private static int[] orbColors(Cfg c) {
        if ("aurora".equals(c.bg)) return new int[] {0xFF00E5A0, 0xFF0096FF, 0xFF8A5CFF};
        if ("ember".equals(c.bg)) return new int[] {0xFFFF2E4D, 0xFFFF7A1A, 0xFFFF5028};
        return new int[] {c.c1, c.c3, c.c2};
    }

    private void prepare(int w, int h, Cfg c) {
        String k = w + "x" + h + "|" + c.c1 + "|" + c.c2 + "|" + c.c3 + "|" + c.bg;
        if (k.equals(key)) return;
        key = k;
        horiz = new LinearGradient(0, 0, w, 0, new int[] {c.c1, c.c2, c.c3}, new float[] {0f, 0.5f, 1f}, Shader.TileMode.CLAMP);
        bgGrad = new LinearGradient(0, 0, 0, h, 0xFF1D1530, 0xFF0C0913, Shader.TileMode.CLAMP);
        float floor = h * 0.74f;
        float top = floor - Math.min(w, h) * 0.5f;
        barGrad = new LinearGradient(0, top, 0, floor, new int[] {c.c3, c.c2, c.c1}, new float[] {0f, 0.55f, 1f}, Shader.TileMode.CLAMP);
        reflGrad = new LinearGradient(0, floor, 0, floor + Math.min(w, h) * 0.18f, alpha(c.c1, 1f), alpha(c.c1, 0f), Shader.TileMode.CLAMP);
        int[] cc = {c.c1, c.c3, c.c2};
        for (int i = 0; i < 3; i++) {
            curtain[i] = new LinearGradient(0, h * 0.22f, 0, h * 0.95f, alpha(cc[i], 0.42f), alpha(cc[i], 0f), Shader.TileMode.CLAMP);
        }
        vignette = new RadialGradient(w / 2f, h * 0.45f, Math.max(w, h) * 0.85f, new int[] {0x00000000, 0x00000000, 0x8C000000}, new float[] {0f, 0.52f, 1f}, Shader.TileMode.CLAMP);
        orbR = Math.max(w, h) * 0.62f;
        int[] oc = orbColors(c);
        for (int i = 0; i < 3; i++) {
            orbs[i] = new RadialGradient(0, 0, orbR, new int[] {alpha(oc[i], 0.85f), alpha(oc[i], 0.22f), alpha(oc[i], 0f)}, new float[] {0f, 0.55f, 1f}, Shader.TileMode.CLAMP);
        }
        float cx = w / 2f;
        float cy = h * 0.52f;
        sweep = new SweepGradient(cx, cy, new int[] {c.c1, c.c2, c.c3, c.c1}, null);
    }

    /** scroll: 0..1 across the home pages; level: loudness 0..1 of what plays (0 = nothing). */
    void draw(Canvas cv, int w, int h, float t, float scroll, float level, Cfg c) {
        if (w <= 0 || h <= 0) return;
        prepare(w, h, c);
        float ts = t * c.speed;
        float calm = 0.4f + 0.12f * (float) Math.sin(ts * 0.6f) + 0.06f * (float) Math.sin(ts * 1.7f);
        float target = c.react && level > 0.02f ? Math.min(1.25f, 0.3f + level * 1.7f) : calm;
        energy += (target - energy) * 0.12f;
        float e = energy;

        // the base
        p.setShader(null);
        p.setStyle(Paint.Style.FILL);
        p.setAlpha(255);
        switch (c.bg) {
            case "glass-black":
            case "amoled":
                cv.drawColor(0xFF000000);
                break;
            case "aurora":
                cv.drawColor(0xFF021219);
                break;
            case "ember":
                cv.drawColor(0xFF10040A);
                break;
            case "dark":
                p.setShader(bgGrad);
                cv.drawRect(0, 0, w, h, p);
                p.setShader(null);
                break;
            default:
                cv.drawColor(0xFF120A24);
        }
        // slow clouds of the palette's colours, sliding with the pages
        boolean sky = !"dark".equals(c.bg) && !"amoled".equals(c.bg);
        if (sky) {
            float[][] spots = {{0.05f, 0.08f, 0.050f, 0.9f}, {0.95f, 0.30f, 0.037f, 1.3f}, {0.45f, 1.02f, 0.044f, 0.7f}};
            float opacity = "glass-black".equals(c.bg) ? 0.3f : 0.62f;
            for (int i = 0; i < 3; i++) {
                float[] s = spots[i];
                float x = w * s[0] + w * 0.09f * (float) Math.sin(ts * s[2] * 6f + i * 2f) - (scroll - 0.5f) * w * (0.14f + 0.08f * i);
                float y = h * s[1] + h * 0.06f * (float) Math.cos(ts * s[2] * 5f + i);
                cv.save();
                cv.translate(x, y);
                p.setShader(orbs[i]);
                p.setAlpha(Math.round(255 * opacity));
                cv.drawCircle(0, 0, orbR, p);
                cv.restore();
            }
            p.setShader(null);
            p.setAlpha(255);
        }

        float shift = -(scroll - 0.5f) * w * 0.2f;
        cv.save();
        cv.translate(shift, 0);
        switch (c.style) {
            case "capsules":
                capsules(cv, w, h, ts, e, c);
                break;
            case "aurora":
                aurora(cv, w, h, ts, e, c);
                break;
            case "orb":
                orb(cv, w, h, ts, e, c);
                break;
            default:
                ribbons(cv, w, h, ts, e, c);
        }
        cv.restore();

        if (!"amoled".equals(c.bg)) {
            p.setShader(vignette);
            cv.drawRect(0, 0, w, h, p);
            p.setShader(null);
        }
    }

    // a smooth line through the points
    private void smooth(int n) {
        path.reset();
        path.moveTo(xs[0], ys[0]);
        for (int i = 1; i < n - 1; i++) {
            float mx = (xs[i] + xs[i + 1]) / 2f;
            float my = (ys[i] + ys[i + 1]) / 2f;
            path.quadTo(xs[i], ys[i], mx, my);
        }
        path.lineTo(xs[n - 1], ys[n - 1]);
    }

    private void ribbons(Canvas cv, int w, int h, float t, float e, Cfg c) {
        float cy = h * 0.62f;
        float base = Math.min(w, h) * 0.12f * c.amp;
        int n = 34;
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setShader(horiz);
        for (int r = 0; r < 5; r++) {
            for (int i = 0; i < n; i++) {
                float u = i / (float) (n - 1);
                float env = (float) Math.sin(Math.PI * u);
                env = env * env * 0.6f + env * 0.4f;
                float y = cy + (r - 2) * base * 0.42f
                    + base * env * e * ((float) Math.sin(u * 6.283f * (1.2f + 0.3f * r) + t * (0.8f + 0.2f * r) + r * 1.3f) * 0.7f
                    + (float) Math.sin(u * 6.283f * 2.7f - t * 1.1f + r) * 0.3f);
                xs[i] = -w * 0.1f + u * w * 1.2f;
                ys[i] = y;
            }
            smooth(n);
            p.setStrokeWidth(dp * 11);
            p.setAlpha(26);
            cv.drawPath(path, p);
            p.setStrokeWidth(dp * 4);
            p.setAlpha(90);
            cv.drawPath(path, p);
            p.setStrokeWidth(dp * 1.6f);
            p.setAlpha(r == 2 ? 255 : 190);
            cv.drawPath(path, p);
        }
        p.setShader(null);
        p.setStyle(Paint.Style.FILL);
        p.setAlpha(255);
    }

    private void capsules(Canvas cv, int w, int h, float t, float e, Cfg c) {
        int n = Math.max(13, Math.min(41, Math.round(w / (dp * 22)))) | 1;
        float total = w * 0.86f;
        float step = total / n;
        float bw = Math.min(step * 0.58f, dp * 16);
        float x0 = (w - total) / 2f + (step - bw) / 2f;
        float floor = h * 0.74f;
        float maxH = Math.min(w, h) * 0.32f * c.amp;
        float rest = bw * 1.6f;
        float mid = (n - 1) / 2f;
        p.setStyle(Paint.Style.FILL);
        for (int i = 0; i < n; i++) {
            float d = Math.abs(i - mid) / mid;
            float noise = 0.5f + 0.5f * (float) Math.sin(t * (1.3f + 0.07f * i) + i * 0.9f) * (float) Math.sin(t * 0.6f + i * 0.37f);
            float arch = 1f - 0.55f * d;
            float tg = rest * (1f + 0.5f * (1f - d) * (1f - d)) + e * (0.35f + 0.65f * noise) * maxH * arch;
            hs[i] += (tg - hs[i]) * 0.25f;
        }
        // soft light around, then the pills, then the reflection
        p.setShader(barGrad);
        p.setAlpha(34);
        for (int i = 0; i < n; i++) {
            float x = x0 + i * step;
            rect.set(x - bw * 0.35f, floor - hs[i] - bw * 0.35f, x + bw * 1.35f, floor + bw * 0.35f);
            cv.drawRoundRect(rect, bw, bw, p);
        }
        p.setAlpha(242);
        for (int i = 0; i < n; i++) {
            float x = x0 + i * step;
            rect.set(x, floor - hs[i], x + bw, floor);
            cv.drawRoundRect(rect, bw / 2f, bw / 2f, p);
        }
        p.setShader(reflGrad);
        p.setAlpha(56);
        float gap = dp * 4;
        for (int i = 0; i < n; i++) {
            float x = x0 + i * step;
            rect.set(x, floor + gap, x + bw, floor + gap + hs[i] * 0.42f);
            cv.drawRoundRect(rect, bw / 2f, bw / 2f, p);
        }
        p.setShader(null);
        p.setAlpha(255);
    }

    private void aurora(Canvas cv, int w, int h, float t, float e, Cfg c) {
        int n = 30;
        p.setStyle(Paint.Style.FILL);
        for (int r = 0; r < 3; r++) {
            for (int i = 0; i < n; i++) {
                float u = i / (float) (n - 1);
                xs[i] = -w * 0.1f + u * w * 1.2f;
                ys[i] = h * (0.34f + 0.10f * r) + h * 0.07f * c.amp * (0.5f + e)
                    * ((float) Math.sin(u * 5f + t * (0.35f + 0.1f * r) + r * 2f) * 0.6f + (float) Math.sin(u * 11f - t * 0.5f + r) * 0.4f);
            }
            smooth(n);
            path.lineTo(xs[n - 1], h);
            path.lineTo(xs[0], h);
            path.close();
            p.setShader(curtain[r]);
            p.setAlpha(Math.round(255 * clamp(0.55f + e * 0.5f, 0f, 1f)));
            cv.drawPath(path, p);
        }
        p.setShader(null);
        p.setAlpha(255);
    }

    private void orb(Canvas cv, int w, int h, float t, float e, Cfg c) {
        float cx = w / 2f;
        float cy = h * 0.52f;
        float r = Math.min(w, h) * 0.2f * c.amp;
        int bars = 72;
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeWidth(dp * 3.2f);
        p.setShader(sweep);
        for (int i = 0; i < bars; i++) {
            float a = i / (float) bars * 6.2832f;
            float nz = 0.5f + 0.5f * (float) Math.sin(t * 1.6f + i * 0.55f) * (float) Math.sin(t * 0.7f + i * 0.21f);
            float len = r * (0.12f + e * (0.25f + 0.75f * nz));
            float x1 = cx + (float) Math.cos(a) * r * 1.08f;
            float y1 = cy + (float) Math.sin(a) * r * 1.08f;
            float x2 = cx + (float) Math.cos(a) * (r * 1.08f + len);
            float y2 = cy + (float) Math.sin(a) * (r * 1.08f + len);
            p.setAlpha(230);
            cv.drawLine(x1, y1, x2, y2, p);
        }
        p.setStrokeWidth(dp * 1.4f);
        p.setAlpha(110);
        cv.drawCircle(cx, cy, r, p);
        p.setStyle(Paint.Style.FILL);
        p.setAlpha(60 + Math.round(60 * e));
        cv.drawCircle(cx, cy, r * 0.96f, p);
        p.setShader(null);
        p.setAlpha(255);
    }
}
