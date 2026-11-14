package app.rezonans.player;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import org.json.JSONObject;
import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.MediaStreamTrack;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpCapabilities;
import org.webrtc.RtpParameters;
import org.webrtc.RtpSender;
import org.webrtc.RtpTransceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;
import org.webrtc.audio.JavaAudioDeviceModule;

import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * One showing of the phone's screen (and sound) on a TV: the same WebRTC the
 * PC uses — H.264 first, no STUN/TURN, the whole SDP each way. The phone's
 * sound (Android 10+) comes from AudioPlaybackCapture: WebRTC's own recorder is
 * opened as usual and, the moment it starts, its microphone is swapped for the
 * playback capture of the same format (the library has no other way in).
 */
final class CastSession {
    private static final String TAG = "RezCast";
    private static final int RATE = 48000;

    interface Listener {
        void onLive();

        void onEnded(String why);
    }

    private final Context ctx;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private EglBase egl;
    private PeerConnectionFactory factory;
    private JavaAudioDeviceModule adm;
    private PeerConnection pc;
    private DataChannel ctl;
    private CastCapturer capturer;
    private SurfaceTextureHelper sth;
    private VideoSource videoSource;
    private AudioSource audioSource;
    private AudioRecord playback;
    private int tvW, tvH, capW, capH;
    private boolean withAudio;
    private volatile boolean live = false;
    private volatile boolean ended = false;
    private final CountDownLatch gathered = new CountDownLatch(1);
    private Runnable lostTimer;
    private volatile int peak = 0;
    private final Runnable report = this::report;

    CastSession(Context c, Listener l) {
        ctx = c.getApplicationContext();
        listener = l;
    }

    boolean isLive() {
        return live;
    }

    int width() {
        return capW;
    }

    int height() {
        return capH;
    }

    boolean hasAudio() {
        return withAudio;
    }

    /** Starts the capture (call from the foreground service, after the person agreed). */
    void start(Intent projection, int tvW, int tvH, boolean audio) {
        this.tvW = tvW;
        this.tvH = tvH;
        this.withAudio = audio && Build.VERSION.SDK_INT >= 29;
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(ctx).createInitializationOptions());
        egl = EglBase.create();
        adm = JavaAudioDeviceModule.builder(ctx)
            .setInputSampleRate(RATE)
            .setUseStereoInput(true)
            .setUseHardwareAcousticEchoCanceler(false)
            .setUseHardwareNoiseSuppressor(false)
            // a plain recorder (not a call's): no call routing or ducking of the phone's sound
            .setAudioSource(MediaRecorder.AudioSource.MIC)
            .setSamplesReadyCallback(this::level)
            .setAudioRecordStateCallback(new JavaAudioDeviceModule.AudioRecordStateCallback() {
                @Override
                public void onWebRtcAudioRecordStart() {
                    swapToPlayback();
                }

                @Override
                public void onWebRtcAudioRecordStop() {
                }
            })
            .createAudioDeviceModule();
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(adm)
            // hardware H.264, High profile first (a cleaner picture for the same bits), VP8 otherwise
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext()))
            .createPeerConnectionFactory();

        int[] size = fit();
        capW = size[0];
        capH = size[1];
        sth = SurfaceTextureHelper.create("rez-cast", egl.getEglBaseContext());
        videoSource = factory.createVideoSource(true);
        capturer = new CastCapturer(projection, new MediaProjection.Callback() {
            @Override
            public void onStop() {
                // the person stopped it from the system (the status bar chip, the lock screen)
                main.post(() -> end("ended"));
            }
        });
        capturer.initialize(sth, ctx, videoSource.getCapturerObserver());
        capturer.startCapture(capW, capH, 30);
        Log.i(TAG, "захват экрана " + capW + "x" + capH + (withAudio ? " со звуком" : " без звука"));
    }

    /** The screen's size now, fitted into the TV's picture (at most 1080p, even numbers). */
    private int[] fit() {
        DisplayMetrics dm = new DisplayMetrics();
        WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        wm.getDefaultDisplay().getRealMetrics(dm);
        int sw = dm.widthPixels, sh = dm.heightPixels;
        // at most 720p across: a phone's encoder and a TV box's Wi-Fi give a clean 720p,
        // a blocky 1080p (upright the phone stays 1080 tall — few pixels across)
        boolean wide = sw > sh;
        int maxW = Math.min(wide ? 1280 : 1920, tvW > 0 ? tvW : 1920);
        int maxH = Math.min(wide ? 720 : 1080, tvH > 0 ? tvH : 1080);
        double k = Math.min(1.0, Math.min(maxW / (double) sw, maxH / (double) sh));
        return new int[] { even(sw * k), even(sh * k) };
    }

    private static int even(double x) {
        return Math.max(2, (int) Math.round(x / 2) * 2);
    }

    /** The phone turned: the picture follows. */
    void rotated() {
        if (capturer == null || ended) return;
        int[] s = fit();
        if (s[0] == capW && s[1] == capH) return;
        capW = s[0];
        capH = s[1];
        Log.i(TAG, "поворот: " + capW + "x" + capH);
        try {
            capturer.changeCaptureFormat(capW, capH, 30);
        } catch (Exception e) {
            Log.w(TAG, "поворот: " + e);
        }
    }

    /** Builds the offer and waits for the addresses (≤2 s): the whole SDP. */
    String offer() throws Exception {
        PeerConnection.RTCConfiguration cfg = new PeerConnection.RTCConfiguration(new ArrayList<>());
        cfg.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        cfg.bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE;
        cfg.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE;
        pc = factory.createPeerConnection(cfg, observer);
        if (pc == null) throw new Exception("webrtc");
        DataChannel.Init init = new DataChannel.Init();
        init.ordered = true;
        ctl = pc.createDataChannel("ctl", init);
        ctl.registerObserver(new DataChannel.Observer() {
            @Override
            public void onBufferedAmountChange(long previousAmount) {
            }

            @Override
            public void onStateChange() {
            }

            @Override
            public void onMessage(DataChannel.Buffer buffer) {
                try {
                    byte[] b = new byte[buffer.data.remaining()];
                    buffer.data.get(b);
                    JSONObject m = new JSONObject(new String(b, StandardCharsets.UTF_8));
                    if ("bye".equals(m.optString("t"))) main.post(() -> end("remote"));
                } catch (Exception ignored) {
                }
            }
        });

        VideoTrack vt = factory.createVideoTrack("screen", videoSource);
        pc.addTrack(vt, Collections.singletonList("rez"));
        if (withAudio) {
            // music, not a call: none of the voice processing
            MediaConstraints mc = new MediaConstraints();
            for (String k : new String[] { "googEchoCancellation", "googAutoGainControl", "googNoiseSuppression", "googHighpassFilter", "googTypingNoiseDetection" }) {
                mc.mandatory.add(new MediaConstraints.KeyValuePair(k, "false"));
            }
            audioSource = factory.createAudioSource(mc);
            AudioTrack at = factory.createAudioTrack("sound", audioSource);
            // the picture's stream: the TV keeps lips and sound together (the captured sound comes
            // ~0.5 s late; unsynced, the picture ran ahead of it)
            pc.addTrack(at, Collections.singletonList("rez"));
        }
        preferH264();

        final Exception[] err = new Exception[1];
        final CountDownLatch made = new CountDownLatch(1);
        pc.createOffer(new Sdp() {
            @Override
            public void onCreateSuccess(SessionDescription d) {
                pc.setLocalDescription(new Sdp() {
                    @Override
                    public void onSetSuccess() {
                        made.countDown();
                    }

                    @Override
                    public void onSetFailure(String e) {
                        err[0] = new Exception(e);
                        made.countDown();
                    }
                }, d);
            }

            @Override
            public void onCreateFailure(String e) {
                err[0] = new Exception(e);
                made.countDown();
            }
        }, new MediaConstraints());
        if (!made.await(10, TimeUnit.SECONDS)) throw new Exception("offer timeout");
        if (err[0] != null) throw err[0];
        gathered.await(2, TimeUnit.SECONDS);
        return pc.getLocalDescription().description;
    }

    private void preferH264() {
        try {
            RtpCapabilities caps = factory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO);
            if (caps == null || caps.codecs == null) return;
            List<RtpCapabilities.CodecCapability> list = new ArrayList<>(caps.codecs);
            Collections.sort(list, (a, b) -> rank(a) - rank(b)); // stable: the rest keep their order
            for (RtpTransceiver t : pc.getTransceivers()) {
                if (t.getMediaType() == MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO) t.setCodecPreferences(list);
            }
        } catch (Exception e) {
            Log.w(TAG, "порядок кодеков: " + e);
        }
    }

    private static int rank(RtpCapabilities.CodecCapability c) {
        String mime = String.valueOf(c.mimeType).toLowerCase();
        String fmtp = c.parameters == null ? "" : c.parameters.toString();
        if (mime.equals("video/h264")) {
            int r = 0;
            if (!fmtp.contains("packetization-mode=1")) r += 4;
            String low = fmtp.toLowerCase();
            if (low.contains("profile-level-id=640c")) r += 0; // constrained high
            else if (low.contains("profile-level-id=42e0")) r += 1; // constrained baseline
            else r += 2;
            return r;
        }
        if (mime.equals("video/vp8")) return 10;
        return 1000;
    }

    /** The TV's answer (already adjusted by the page: addresses, stereo, start bitrate). */
    void answer(String sdp) throws Exception {
        final Exception[] err = new Exception[1];
        final CountDownLatch set = new CountDownLatch(1);
        pc.setRemoteDescription(new Sdp() {
            @Override
            public void onSetSuccess() {
                set.countDown();
            }

            @Override
            public void onSetFailure(String e) {
                err[0] = new Exception(e);
                set.countDown();
            }
        }, new SessionDescription(SessionDescription.Type.ANSWER, sdp));
        if (!set.await(10, TimeUnit.SECONDS)) throw new Exception("answer timeout");
        if (err[0] != null) throw err[0];
        // start sharp: WebRTC would start at 300 kbit/s and climb for many seconds
        try {
            // a TV box's Wi-Fi queues anything above a few Mbit/s: seconds of delay (seen 0.5–1.1 s
            // round trip at 4–8 Mbit/s, 25–70 ms at 2–3 Mbit/s)
            pc.setBitrate(1_000_000, 2_500_000, 4_000_000);
        } catch (Exception e) {
            Log.w(TAG, "битрейт: " + e);
        }
        main.postDelayed(report, 5000);
        // a clear picture on the home network; under load keep the motion smooth
        for (RtpSender s : pc.getSenders()) {
            MediaStreamTrack t = s.track();
            if (t == null) continue;
            try {
                RtpParameters p = s.getParameters();
                if (p.encodings == null || p.encodings.isEmpty()) continue;
                if ("video".equals(t.kind())) {
                    p.encodings.get(0).maxBitrateBps = 4_000_000;
                    p.encodings.get(0).minBitrateBps = 1_000_000;
                    p.encodings.get(0).maxFramerate = 30;
                    p.encodings.get(0).scaleResolutionDownBy = 1.0;
                    // a screen: text and details stay sharp; under load fewer frames, not a smaller picture
                    p.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_RESOLUTION;
                } else {
                    p.encodings.get(0).maxBitrateBps = 192_000;
                }
                s.setParameters(p);
            } catch (Exception e) {
                Log.w(TAG, "параметры отправки: " + e);
            }
        }
    }

    // the loudest sample since the last report (to see in the log that sound goes)
    private void level(JavaAudioDeviceModule.AudioSamples a) {
        byte[] d = a.getData();
        int p = peak;
        for (int i = 0; i + 1 < d.length; i += 2) {
            int v = Math.abs((short) ((d[i] & 0xff) | (d[i + 1] << 8)));
            if (v > p) p = v;
        }
        peak = p;
    }

    // what goes to the TV, every 5 s in the log
    private void report() {
        if (ended || pc == null) return;
        pc.getStats((r) -> {
            StringBuilder b = new StringBuilder();
            for (org.webrtc.RTCStats st : r.getStatsMap().values()) {
                java.util.Map<String, Object> m = st.getMembers();
                if ("remote-inbound-rtp".equals(st.getType())) {
                    b.append(m.get("kind")).append(" на ТВ: туда-обратно ").append(m.get("roundTripTime")).append(" с, джиттер ").append(m.get("jitter")).append(" с, потеряно ").append(m.get("packetsLost")).append("; ");
                    continue;
                }
                if (!"outbound-rtp".equals(st.getType())) continue;
                if ("video".equals(m.get("kind"))) {
                    b.append("видео ").append(m.get("frameWidth")).append('x').append(m.get("frameHeight"))
                        .append(' ').append(m.get("framesPerSecond")).append(" к/с, ")
                        .append(m.get("targetBitrate")).append(" бит/с, ограничение ").append(m.get("qualityLimitationReason"))
                        .append(", кодек ").append(m.get("encoderImplementation")).append("; ");
                } else if ("audio".equals(m.get("kind"))) {
                    b.append("звук отправлено ").append(m.get("bytesSent")).append(" байт; ");
                }
            }
            b.append("громкость ").append(peak);
            peak = 0;
            Log.i(TAG, b.toString());
        });
        main.postDelayed(report, 5000);
    }

    @SuppressLint("MissingPermission")
    private void swapToPlayback() {
        if (!withAudio || Build.VERSION.SDK_INT < 29 || capturer == null) return;
        try {
            MediaProjection mp = capturer.projection();
            if (mp == null) return;
            AudioPlaybackCaptureConfiguration cfg = new AudioPlaybackCaptureConfiguration.Builder(mp)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build();
            AudioFormat fmt = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build();
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT);
            AudioRecord mine = new AudioRecord.Builder()
                .setAudioFormat(fmt)
                .setBufferSizeInBytes(min) // as little sound waiting as the system allows
                .setAudioPlaybackCaptureConfig(cfg)
                .build();
            if (mine.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.w(TAG, "звук телефона: не открылся");
                mine.release();
                return;
            }
            mine.startRecording();
            Field fin = JavaAudioDeviceModule.class.getField("audioInput");
            Object input = fin.get(adm);
            Field frec = input.getClass().getDeclaredField("audioRecord");
            frec.setAccessible(true);
            AudioRecord mic = (AudioRecord) frec.get(input);
            frec.set(input, mine);
            playback = mine;
            if (mic != null) {
                try {
                    mic.stop();
                } catch (Exception ignored) {
                }
                mic.release();
            }
            Log.i(TAG, "звук телефона идёт на телевизор");
        } catch (Throwable e) {
            Log.w(TAG, "звук телефона: " + e);
        }
    }

    private final PeerConnection.Observer observer = new PeerConnection.Observer() {
        @Override
        public void onSignalingChange(PeerConnection.SignalingState s) {
        }

        @Override
        public void onIceConnectionChange(PeerConnection.IceConnectionState s) {
        }

        @Override
        public void onConnectionChange(PeerConnection.PeerConnectionState s) {
            main.post(() -> {
                if (ended) return;
                if (s == PeerConnection.PeerConnectionState.CONNECTED) {
                    if (lostTimer != null) main.removeCallbacks(lostTimer);
                    lostTimer = null;
                    if (!live) {
                        live = true;
                        listener.onLive();
                    }
                } else if (s == PeerConnection.PeerConnectionState.FAILED || s == PeerConnection.PeerConnectionState.CLOSED) {
                    end("lost");
                } else if (s == PeerConnection.PeerConnectionState.DISCONNECTED) {
                    // Wi-Fi hiccups: give it a few seconds
                    if (lostTimer != null) main.removeCallbacks(lostTimer);
                    lostTimer = () -> end("lost");
                    main.postDelayed(lostTimer, 6000);
                }
            });
        }

        @Override
        public void onIceConnectionReceivingChange(boolean receiving) {
        }

        @Override
        public void onIceGatheringChange(PeerConnection.IceGatheringState s) {
            if (s == PeerConnection.IceGatheringState.COMPLETE) gathered.countDown();
        }

        @Override
        public void onIceCandidate(IceCandidate c) {
        }

        @Override
        public void onIceCandidatesRemoved(IceCandidate[] c) {
        }

        @Override
        public void onAddStream(MediaStream s) {
        }

        @Override
        public void onRemoveStream(MediaStream s) {
        }

        @Override
        public void onDataChannel(DataChannel d) {
        }

        @Override
        public void onRenegotiationNeeded() {
        }
    };

    /** Ends the showing (once): tells the TV, frees everything. */
    void end(String why) {
        if (ended) return;
        ended = true;
        live = false;
        if (lostTimer != null) main.removeCallbacks(lostTimer);
        main.removeCallbacks(report);
        Log.i(TAG, "конец показа: " + why);
        if (!"remote".equals(why) && ctl != null) {
            try {
                ctl.send(new DataChannel.Buffer(ByteBuffer.wrap("{\"t\":\"bye\"}".getBytes(StandardCharsets.UTF_8)), false));
            } catch (Exception ignored) {
            }
        }
        // the bye needs a moment to leave before the connection closes
        main.postDelayed(this::free, "remote".equals(why) ? 0 : 250);
        listener.onEnded(why);
    }

    private void free() {
        try {
            if (capturer != null) capturer.stopCapture();
        } catch (Exception ignored) {
        }
        try {
            if (ctl != null) ctl.dispose();
        } catch (Exception ignored) {
        }
        try {
            if (pc != null) pc.dispose();
        } catch (Exception ignored) {
        }
        try {
            if (capturer != null) capturer.dispose();
        } catch (Exception ignored) {
        }
        try {
            if (videoSource != null) videoSource.dispose();
        } catch (Exception ignored) {
        }
        try {
            if (audioSource != null) audioSource.dispose();
        } catch (Exception ignored) {
        }
        try {
            if (sth != null) sth.dispose();
        } catch (Exception ignored) {
        }
        try {
            if (factory != null) factory.dispose();
        } catch (Exception ignored) {
        }
        try {
            if (adm != null) adm.release();
        } catch (Exception ignored) {
        }
        try {
            if (egl != null) egl.release();
        } catch (Exception ignored) {
        }
        playback = null;
    }

    private abstract static class Sdp implements SdpObserver {
        @Override
        public void onCreateSuccess(SessionDescription d) {
        }

        @Override
        public void onSetSuccess() {
        }

        @Override
        public void onCreateFailure(String e) {
        }

        @Override
        public void onSetFailure(String e) {
        }
    }
}
