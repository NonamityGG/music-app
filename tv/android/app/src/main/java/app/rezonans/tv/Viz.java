package app.rezonans.tv;

import android.Manifest;
import android.content.pm.PackageManager;
import android.media.audiofx.Visualizer;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

/**
 * The waves hear what the TV plays: the system Visualizer on the output mix,
 * 64 bands from 35 Hz to 15 kHz and a short piece of the wave, about 20 times
 * a second, sent to the page. Runs only while the home screen is in front and
 * something is playing (it costs nothing otherwise).
 */
final class Viz {
    static final int BANDS = 64;
    static final int WAVE = 64;
    private static Visualizer v;
    private static long lastSend;
    private static final float[] bands = new float[BANDS];
    private static final float[] wave = new float[WAVE];
    private static boolean failed;
    private static volatile Page target;

    private Viz() {
    }

    static void resume(Page a) {
        if (a == null) return;
        android.content.Context c = a.context();
        boolean want = a.isVisible() && Prefs.viz(c) && MediaHub.playing();
        if (!want) {
            if (target == null || target == a) stop();
            return;
        }
        target = a;
        if (v != null || failed) return;
        if (Build.VERSION.SDK_INT >= 23 && c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        try {
            v = new Visualizer(0);
            int[] range = Visualizer.getCaptureSizeRange();
            v.setCaptureSize(Math.min(1024, range[1]));
            int rate = Math.min(Visualizer.getMaxCaptureRate(), 20000);
            final int fs = v.getSamplingRate(); // milliHertz
            v.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
                @Override
                public void onWaveFormDataCapture(Visualizer vis, byte[] w, int samplingRate) {
                    int n = w.length;
                    for (int i = 0; i < WAVE; i++) wave[i] = ((w[i * n / WAVE] & 0xFF) - 128) / 128f;
                }

                @Override
                public void onFftDataCapture(Visualizer vis, byte[] fft, int samplingRate) {
                    fill(fft, fs / 1000f);
                    Page t = target;
                    if (t != null) send(t);
                }
            }, rate, true, true);
            v.setEnabled(true);
        } catch (Throwable e) {
            Log.w(MainActivity.TAG, "visualizer: " + e);
            failed = true; // this box doesn't allow it: the waves dance by themselves
            stop();
        }
    }

    /** Stops the sound for this page only (another may have it now). */
    static void stopFor(Page p) {
        if (target == null || target == p) stop();
    }

    static void stop() {
        if (v == null) return;
        try {
            v.setEnabled(false);
            v.release();
        } catch (Throwable ignored) {
        }
        v = null;
        target = null;
    }

    private static void fill(byte[] fft, float fs) {
        int n = fft.length; // re/im pairs from index 2
        int bins = n / 2;
        float nyq = fs / 2f;
        float lo = 35f;
        float hi = Math.min(15000f, nyq);
        int prevEnd = 1;
        for (int b = 0; b < BANDS; b++) {
            float f1 = (float) (lo * Math.pow(hi / lo, (b + 1) / (double) BANDS));
            int end = Math.max(prevEnd + 1, Math.round(f1 / nyq * bins));
            end = Math.min(end, bins);
            float peak = 0;
            for (int k = prevEnd; k < end; k++) {
                float re = fft[2 * k];
                float im = fft[2 * k + 1];
                float m = (float) Math.hypot(re, im);
                if (m > peak) peak = m;
            }
            prevEnd = end;
            // magnitude (0..~180) to a level: dB from a quiet floor
            double db = 20 * Math.log10(peak + 1);
            float val = (float) ((db - 9) / 33.0);
            val *= 1f + (b / (float) BANDS) * 0.5f; // highs are naturally quieter
            bands[b] = Math.max(0f, Math.min(1f, val));
        }
    }

    private static void send(Page a) {
        long now = SystemClock.uptimeMillis();
        if (now - lastSend < 45) return;
        lastSend = now;
        StringBuilder sb = new StringBuilder(BANDS * 6 + WAVE * 6 + 16);
        sb.append("{\"b\":[");
        for (int i = 0; i < BANDS; i++) {
            if (i > 0) sb.append(',');
            sb.append(Math.round(bands[i] * 100) / 100f);
        }
        sb.append("],\"w\":[");
        for (int i = 0; i < WAVE; i++) {
            if (i > 0) sb.append(',');
            sb.append(Math.round(wave[i] * 100) / 100f);
        }
        sb.append("]}");
        a.emit("viz", sb.toString());
    }
}
