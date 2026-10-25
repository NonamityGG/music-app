package app.rezonans.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import android.util.LruCache;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * What's playing on the TV (any app with a media session: Okko, YouTube, a
 * music app…) and its buttons. Needs notification access for Резонанс OS
 * (given once with adb; see the installer).
 */
final class MediaHub {
    private static MediaController ctl;
    private static Bitmap art;
    private static byte[] artBytes;
    private static int artVersion;
    private static String artSig = "";
    private static String loadingUri = null;
    private static Context app;
    private static final ExecutorService io = Executors.newSingleThreadExecutor();
    private static final LruCache<String, Bitmap> byUri = new LruCache<>(6);
    private static String lastJson = "";
    private static MediaSessionManager.OnActiveSessionsChangedListener sessionsListener;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private MediaHub() {
    }

    static boolean listenerEnabled(Context c) {
        String s = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        return s != null && s.contains(c.getPackageName());
    }

    /** Starts watching media sessions, if notification access is there. */
    static synchronized void attach(Context c) {
        app = c.getApplicationContext();
        if (!listenerEnabled(c)) return;
        try {
            MediaSessionManager m = (MediaSessionManager) c.getSystemService(Context.MEDIA_SESSION_SERVICE);
            ComponentName cn = new ComponentName(c, MediaListener.class);
            if (sessionsListener == null) {
                sessionsListener = MediaHub::setSessions;
                m.addOnActiveSessionsChangedListener(sessionsListener, cn, main);
            }
            setSessions(m.getActiveSessions(cn));
        } catch (Exception ignored) {
            // no access yet
        }
    }

    static void refresh(Context c) {
        attach(c);
        publish(true);
    }

    static synchronized void setSessions(List<MediaController> list) {
        MediaController pick = null;
        if (list != null) {
            for (MediaController m : list) {
                PlaybackState st = m.getPlaybackState();
                if (st != null && st.getState() == PlaybackState.STATE_PLAYING) {
                    pick = m;
                    break;
                }
            }
            if (pick == null && !list.isEmpty()) pick = list.get(0);
        }
        if (ctl != null && (pick == null || !ctl.getSessionToken().equals(pick.getSessionToken()))) {
            try {
                ctl.unregisterCallback(callback);
            } catch (Exception ignored) {
            }
        }
        boolean changed = pick == null ? ctl != null : ctl == null || !ctl.getSessionToken().equals(pick.getSessionToken());
        ctl = pick;
        if (changed && ctl != null) ctl.registerCallback(callback, main);
        readArt();
        publish(true);
    }

    private static final MediaController.Callback callback = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            publish(false);
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            readArt();
            publish(true);
        }

        @Override
        public void onSessionDestroyed() {
            synchronized (MediaHub.class) {
                ctl = null;
            }
            publish(true);
        }
    };

    // ---------- the cover ----------
    // Apps give it in different ways: a picture in the session (most), only an
    // address of it (some load it themselves: https or content://), or only in
    // their playback notification. All three are tried, in that order.

    private static final String[] BITMAPS = {MediaMetadata.METADATA_KEY_ALBUM_ART, MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_DISPLAY_ICON};
    private static final String[] URIS = {MediaMetadata.METADATA_KEY_ALBUM_ART_URI, MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI};

    /** Looks for the cover again; true if it changed. */
    private static synchronized boolean readArt() {
        MediaMetadata md = ctl != null ? ctl.getMetadata() : null;
        String pkg = ctl != null ? ctl.getPackageName() : null;
        if (md == null) return setArt(null);
        for (String k : BITMAPS) {
            Bitmap b = null;
            try {
                b = md.getBitmap(k);
            } catch (Exception ignored) {
            }
            if (b != null && b.getWidth() > 1) return setArt(b);
        }
        String uri = null;
        for (String k : URIS) {
            String u = md.getString(k);
            if (u != null && !u.trim().isEmpty()) {
                uri = u.trim();
                break;
            }
        }
        if (uri != null) {
            Bitmap cached = byUri.get(uri);
            if (cached != null) return setArt(cached);
            load(uri);
        }
        // meanwhile (or instead): the picture in the app's playback notification
        Bitmap n = MediaListener.coverOf(pkg);
        if (n != null) return setArt(n);
        return setArt(null);
    }

    private static boolean setArt(Bitmap b) {
        String sig = sig(b);
        if (sig.equals(artSig)) return false;
        artSig = sig;
        art = b;
        artBytes = null;
        artVersion++;
        return true;
    }

    /** A cheap fingerprint, so the same picture sent again isn't reloaded. */
    private static String sig(Bitmap b) {
        if (b == null) return "";
        StringBuilder s = new StringBuilder().append(b.getWidth()).append('x').append(b.getHeight());
        try {
            long sum = 0;
            for (int i = 1; i <= 5; i++) {
                for (int j = 1; j <= 5; j++) sum = sum * 31 + b.getPixel(b.getWidth() * i / 6, b.getHeight() * j / 6);
            }
            s.append(':').append(sum);
        } catch (Exception e) {
            s.append(':').append(System.identityHashCode(b));
        }
        return s.toString();
    }

    private static final java.util.Set<String> failed = new java.util.HashSet<>();

    private static void load(final String uri) {
        if (uri.equals(loadingUri) || failed.contains(uri) || app == null) return;
        loadingUri = uri;
        final Context c = app;
        io.execute(() -> {
            Bitmap b = fetch(c, uri);
            boolean changed = false;
            synchronized (MediaHub.class) {
                if (uri.equals(loadingUri)) loadingUri = null;
                if (b == null) {
                    if (failed.size() > 50) failed.clear();
                    failed.add(uri);
                } else {
                    byUri.put(uri, b);
                    // still the same track?
                    MediaMetadata md = ctl != null ? ctl.getMetadata() : null;
                    boolean same = false;
                    if (md != null) {
                        for (String k : URIS) same |= uri.equals(md.getString(k) != null ? md.getString(k).trim() : null);
                    }
                    if (same) changed = setArt(b);
                }
            }
            if (changed) main.post(() -> publish(true));
        });
    }

    private static Bitmap fetch(Context c, String uri) {
        InputStream in = null;
        try {
            // Яндекс отдаёт адрес обложки с размером «%%»
            String u = uri.replace("%%", "400x400");
            String scheme = Uri.parse(u).getScheme();
            if ("http".equals(scheme) || "https".equals(scheme)) {
                HttpURLConnection h = (HttpURLConnection) new URL(u).openConnection();
                h.setConnectTimeout(6000);
                h.setReadTimeout(10000);
                h.setInstanceFollowRedirects(true);
                h.setRequestProperty("User-Agent", "RezonansOS");
                in = h.getInputStream();
            } else {
                in = c.getContentResolver().openInputStream(Uri.parse(u));
            }
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) > 0 && buf.size() < 12 * 1024 * 1024) buf.write(chunk, 0, n);
            byte[] data = buf.toByteArray();
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, o);
            int side = Math.max(o.outWidth, o.outHeight);
            o.inJustDecodeBounds = false;
            o.inSampleSize = 1;
            while (side / (o.inSampleSize * 2) >= 512) o.inSampleSize *= 2;
            return BitmapFactory.decodeByteArray(data, 0, data.length, o);
        } catch (Exception | OutOfMemoryError e) {
            Log.w(MainActivity.TAG, "cover " + uri + ": " + e);
            return null;
        } finally {
            try {
                if (in != null) in.close();
            } catch (Exception ignored) {
            }
        }
    }

    /** The playback notification of the app that plays changed: maybe a cover came. */
    static void notificationChanged(String pkg) {
        boolean changed;
        synchronized (MediaHub.class) {
            if (ctl == null || pkg == null || !pkg.equals(ctl.getPackageName())) return;
            changed = readArt();
        }
        if (changed) publish(true);
    }

    static synchronized byte[] artJpeg() {
        if (art == null) return null;
        if (artBytes == null) {
            try {
                Bitmap b = art;
                int max = Math.max(b.getWidth(), b.getHeight());
                if (max > 512) {
                    float k = 512f / max;
                    b = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * k)), Math.max(1, Math.round(b.getHeight() * k)), true);
                }
                if (b.getConfig() == null || (Build.VERSION.SDK_INT >= 26 && b.getConfig() == Bitmap.Config.HARDWARE)) b = b.copy(Bitmap.Config.ARGB_8888, false);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                b.compress(Bitmap.CompressFormat.JPEG, 90, out);
                artBytes = out.toByteArray();
            } catch (Exception e) {
                Log.w(MainActivity.TAG, "cover: " + e);
                return null;
            }
        }
        return artBytes;
    }

    static synchronized String json() {
        JSONObject o = new JSONObject();
        try {
            if (ctl == null) {
                o.put("active", false);
                return o.toString();
            }
            MediaMetadata md = ctl.getMetadata();
            PlaybackState st = ctl.getPlaybackState();
            String title = md != null ? md.getString(MediaMetadata.METADATA_KEY_TITLE) : null;
            if (title == null && md != null) title = md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
            String artist = md != null ? md.getString(MediaMetadata.METADATA_KEY_ARTIST) : null;
            if (artist == null && md != null) artist = md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
            if (artist == null && md != null) artist = md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE);
            int state = st != null ? st.getState() : PlaybackState.STATE_NONE;
            boolean playing = state == PlaybackState.STATE_PLAYING || state == PlaybackState.STATE_BUFFERING;
            long pos = 0;
            if (st != null) {
                pos = st.getPosition();
                if (state == PlaybackState.STATE_PLAYING) pos += (long) ((SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime()) * st.getPlaybackSpeed());
            }
            long dur = md != null ? md.getLong(MediaMetadata.METADATA_KEY_DURATION) : 0;
            boolean any = title != null || artist != null;
            o.put("active", any && state != PlaybackState.STATE_NONE && state != PlaybackState.STATE_STOPPED && state != PlaybackState.STATE_ERROR);
            o.put("app", ctl.getPackageName());
            o.put("appLabel", label(ctl.getPackageName()));
            o.put("title", title == null ? "" : title);
            o.put("artist", artist == null ? "" : artist);
            o.put("album", md != null && md.getString(MediaMetadata.METADATA_KEY_ALBUM) != null ? md.getString(MediaMetadata.METADATA_KEY_ALBUM) : "");
            o.put("playing", playing);
            o.put("pos", Math.max(0, pos));
            o.put("dur", Math.max(0, dur));
            o.put("art", art != null ? artVersion : 0);
            long actions = st != null ? st.getActions() : 0;
            o.put("canNext", (actions & PlaybackState.ACTION_SKIP_TO_NEXT) != 0);
            o.put("canPrev", (actions & PlaybackState.ACTION_SKIP_TO_PREVIOUS) != 0);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private static String label(String pkg) {
        Context a = app;
        if (a == null) return pkg;
        try {
            PackageManager pm = a.getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return pkg;
        }
    }

    private static void publish(boolean always) {
        String j = json();
        if (!always && j.equals(lastJson)) return;
        lastJson = j;
        Page.All.emit("media", j);
        main.post(() -> Viz.resume(Page.All.shown()));
    }

    static synchronized void action(String what) {
        if (ctl == null) return;
        MediaController.TransportControls t = ctl.getTransportControls();
        PlaybackState st = ctl.getPlaybackState();
        boolean playing = st != null && st.getState() == PlaybackState.STATE_PLAYING;
        switch (what) {
            case "toggle":
                if (playing) t.pause();
                else t.play();
                break;
            case "play":
                t.play();
                break;
            case "pause":
                t.pause();
                break;
            case "next":
                t.skipToNext();
                break;
            case "prev":
                t.skipToPrevious();
                break;
            default:
                break;
        }
    }

    static synchronized boolean playing() {
        PlaybackState st = ctl != null ? ctl.getPlaybackState() : null;
        return st != null && st.getState() == PlaybackState.STATE_PLAYING;
    }
}
