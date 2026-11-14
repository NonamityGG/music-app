package app.rezonans.player;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Резонанс Connect for the page: the phone's screen and sound on a TV running
 * Резонанс OS. The page (src/cast.js) leads, like Резонанс для ПК's cast window:
 * open() → TVs come → request(hello/offer) → capture() → offer() → answer().
 * Native here: being seen on the network, the screen capture, WebRTC.
 *
 * Events: "tv" {tv}, "gone" {id}, "state" {live, why}.
 */
@CapacitorPlugin(name = "Cast", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class CastPlugin extends Plugin {
    private static final String TAG = "RezCast";
    private static CastPlugin self;
    private static CastPresence presence;
    private static CastSession session;
    private static final ExecutorService work = Executors.newSingleThreadExecutor();
    private static final ExecutorService talk = Executors.newCachedThreadPool();

    @Override
    public void load() {
        self = this;
    }

    private String myId() {
        SharedPreferences p = getContext().getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
        String id = p.getString("castId", null);
        if (id == null) {
            byte[] b = new byte[12];
            new SecureRandom().nextBytes(b);
            StringBuilder s = new StringBuilder();
            for (byte x : b) s.append(String.format("%02x", x & 0xff));
            id = s.toString();
            p.edit().putString("castId", id).apply();
        }
        return id;
    }

    private String myName() {
        String n = null;
        try {
            n = Settings.Global.getString(getContext().getContentResolver(), "device_name");
        } catch (Exception ignored) {
        }
        if (n == null || n.trim().isEmpty()) {
            String m = Build.MODEL == null ? "" : Build.MODEL;
            String b = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
            n = m.toLowerCase().startsWith(b.toLowerCase()) ? m : (b + " " + m).trim();
        }
        return n.isEmpty() ? "Телефон" : n;
    }

    /** Shows up on the network; resolves {id, name, tvs}. */
    @PluginMethod
    public void open(PluginCall call) {
        String id = myId();
        String name = myName();
        synchronized (CastPlugin.class) {
            if (presence == null) {
                presence = new CastPresence(getContext(), id, name, new CastPresence.Listener() {
                    @Override
                    public void onTv(JSONObject tv) {
                        try {
                            emit("tv", new JSObject().put("tv", JSObject.fromJSONObject(tv)));
                        } catch (Exception ignored) {
                        }
                    }

                    @Override
                    public void onGone(String tvId) {
                        emit("gone", new JSObject().put("id", tvId));
                    }
                });
                try {
                    presence.start();
                } catch (Exception e) {
                    presence = null;
                    call.reject("net");
                    return;
                }
            }
        }
        JSObject r = new JSObject();
        r.put("id", id);
        r.put("name", name);
        JSArray list = new JSArray();
        for (JSONObject t : presence.tvs()) list.put(t);
        r.put("tvs", list);
        r.put("audio", Build.VERSION.SDK_INT >= 29);
        r.put("live", session != null && session.isLive());
        call.resolve(r);
    }

    /** No longer seen (unless a showing goes on). */
    @PluginMethod
    public void close(PluginCall call) {
        if (session == null) dropPresence();
        call.resolve();
    }

    private static void dropPresence() {
        synchronized (CastPlugin.class) {
            if (presence != null) presence.stop();
            presence = null;
        }
    }

    /** {tv, method, path, body, timeout} → {status, body}. */
    @PluginMethod
    public void request(PluginCall call) {
        final CastPresence p = presence;
        final String tv = call.getString("tv", "");
        final String method = call.getString("method", "POST");
        final String path = call.getString("path", "");
        final JSObject body = call.getObject("body", new JSObject());
        final long timeout = call.getInt("timeout", 8000);
        talk.execute(() -> {
            JSONObject r = p == null ? null : p.request(tv, method, path, body, timeout);
            if (r == null) {
                call.resolve(new JSObject().put("status", 0).put("body", new JSObject().put("ok", false).put("error", "net")));
                return;
            }
            try {
                call.resolve(JSObject.fromJSONObject(r));
            } catch (Exception e) {
                call.reject("net");
            }
        });
    }

    /** Asks the system for the screen (and the microphone permission for the sound), starts the capture: {w, h, audio}. */
    @PluginMethod
    public void capture(PluginCall call) {
        if (session != null) {
            session.end("replaced");
            session = null;
        }
        if (Build.VERSION.SDK_INT >= 29 && getPermissionState("microphone") != PermissionState.GRANTED && !call.getBoolean("noAudio", false)) {
            requestPermissionForAlias("microphone", call, "micAnswered");
            return;
        }
        askScreen(call);
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void micAnswered(PluginCall call) {
        askScreen(call);
    }

    private void askScreen(PluginCall call) {
        MediaProjectionManager mpm = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "projected");
    }

    @ActivityCallback
    private void projected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("denied");
            return;
        }
        final android.content.Intent data = result.getData();
        final int tvW = call.getInt("w", 1920);
        final int tvH = call.getInt("h", 1080);
        final boolean audio = getPermissionState("microphone") == PermissionState.GRANTED;
        CastService.start(getContext(), (svc) -> work.execute(() -> {
            if (svc == null) {
                call.reject("service");
                return;
            }
            try {
                CastSession s = new CastSession(getContext(), new CastSession.Listener() {
                    @Override
                    public void onLive() {
                        CastService c = CastService.current();
                        if (c != null) c.title("Экран телефона на телевизоре");
                        emit("state", new JSObject().put("live", true));
                    }

                    @Override
                    public void onEnded(String why) {
                        ended(why);
                    }
                });
                session = s;
                s.start(data, tvW, tvH, audio);
                call.resolve(new JSObject().put("w", s.width()).put("h", s.height()).put("audio", s.hasAudio()));
            } catch (Exception e) {
                Log.w(TAG, "захват: " + e);
                ended("webrtc");
                call.reject("webrtc");
            }
        }));
    }

    @PluginMethod
    public void offer(PluginCall call) {
        final CastSession s = session;
        if (s == null) {
            call.reject("off");
            return;
        }
        work.execute(() -> {
            try {
                call.resolve(new JSObject().put("sdp", s.offer()));
            } catch (Exception e) {
                Log.w(TAG, "предложение: " + e);
                call.reject("webrtc");
            }
        });
    }

    @PluginMethod
    public void answer(PluginCall call) {
        final CastSession s = session;
        final String sdp = call.getString("sdp", "");
        if (s == null) {
            call.reject("off");
            return;
        }
        work.execute(() -> {
            try {
                s.answer(sdp);
                call.resolve();
            } catch (Exception e) {
                Log.w(TAG, "ответ ТВ: " + e);
                call.reject("webrtc");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopFromSystem(call.getString("why", "phone"));
        call.resolve();
    }

    static void stopFromSystem(String why) {
        CastSession s = session;
        if (s != null) s.end(why);
        else ended(why);
    }

    static void rotated() {
        CastSession s = session;
        if (s != null) work.execute(s::rotated);
    }

    private static void ended(String why) {
        session = null;
        CastPlugin p = self;
        if (p != null) {
            CastService.stopNow(p.getContext());
            p.emit("state", new JSObject().put("live", false).put("why", why));
        }
        Log.i(TAG, "показ закончен (" + why + ")");
    }

    private void emit(String name, JSObject data) {
        notifyListeners(name, data, false);
    }
}
