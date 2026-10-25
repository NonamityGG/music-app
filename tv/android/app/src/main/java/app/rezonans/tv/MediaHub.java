package app.rezonans.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * What's playing on the TV (any app with a media session: Okko, YouTube, a
 * music app…) and its buttons. Needs notification access for Резонанс OS
 * (given once with adb; see the installer).
 */
final class MediaHub {
    private static MediaController ctl;
    private static Bitmap art;
    private static byte[] artPng;
    private static int artVersion;
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

    private static synchronized void readArt() {
        Bitmap b = null;
        MediaMetadata md = ctl != null ? ctl.getMetadata() : null;
        if (md != null) {
            b = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
        }
        if (b != art) {
            art = b;
            artPng = null;
            artVersion++;
        }
    }

    static synchronized byte[] artPng() {
        if (art == null) return null;
        if (artPng == null) {
            Bitmap b = art;
            int max = Math.max(b.getWidth(), b.getHeight());
            if (max > 512) {
                float k = 512f / max;
                b = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.PNG, 95, out);
            artPng = out.toByteArray();
        }
        return artPng;
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
        MainActivity a = MainActivity.current;
        if (a == null) return pkg;
        try {
            PackageManager pm = a.getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return pkg;
        }
    }

    private static void publish(boolean always) {
        MainActivity a = MainActivity.current;
        if (a == null) return;
        String j = json();
        if (!always && j.equals(lastJson)) return;
        lastJson = j;
        a.emit("media", j);
        a.ui.post(() -> Viz.resume(a));
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
