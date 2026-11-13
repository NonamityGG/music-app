package app.rezonans.tv;

import android.content.Context;
import android.content.Intent;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Резонанс Connect, the TV's half: «Приём экрана». A computer on the same
 * Wi-Fi finds the box (mDNS/NSD as _rezonans-connect._tcp, or a broadcast
 * question on UDP 48231), asks to show its screen over a tiny HTTP server on
 * TCP 48230, and sends a WebRTC offer; the page (connect.js) answers it and
 * shows the picture full screen. Only for computers on the local network, and
 * only for ones that typed the code shown on the TV (see Pairing).
 *
 *   GET  /connect/info                          -> {proto, id, name, w, h}
 *   POST /connect/hello {from, name}            -> {ok, paired}   (not paired: the TV shows a code)
 *   POST /connect/offer {from, name, code|token, sdp} -> {ok, sdp, token?}
 *   POST /connect/bye   {from, token}           -> {ok}
 */
final class Connect {
    static final int PORT = 48230;
    static final int FIND_PORT = 48231;
    static final String TYPE = "_rezonans-connect._tcp";
    static final int PROTO = 1;
    private static final String TAG = MainActivity.TAG;

    private static Connect self;

    static synchronized void start(Context c) {
        if (self != null) return;
        self = new Connect(c.getApplicationContext());
        self.run();
    }

    static Connect get() {
        return self;
    }

    private final Context ctx;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    final Pairing pairing;
    private final String id;

    private Connect(Context c) {
        ctx = c;
        android.content.SharedPreferences p = c.getSharedPreferences("rez", Context.MODE_PRIVATE);
        String i = p.getString("connectId", null);
        if (i == null) {
            i = UUID.randomUUID().toString();
            p.edit().putString("connectId", i).apply();
        }
        id = i;
        pairing = new Pairing(p.getString("connectKnown", ""));
    }

    private void savePairing() {
        ctx.getSharedPreferences("rez", Context.MODE_PRIVATE).edit().putString("connectKnown", pairing.save()).apply();
    }

    void forgetAll() {
        pairing.forgetAll();
        savePairing();
    }

    private void run() {
        Thread http = new Thread(this::serve, "connect-http");
        http.setDaemon(true);
        http.start();
        Thread find = new Thread(this::answerFinders, "connect-find");
        find.setDaemon(true);
        find.start();
        ui.post(this::announce);
    }

    // ---------- who the TV is ----------

    String name() {
        String n = null;
        try {
            if (Build.VERSION.SDK_INT >= 25) n = Settings.Global.getString(ctx.getContentResolver(), Settings.Global.DEVICE_NAME);
        } catch (Exception ignored) {
        }
        if (n == null || n.trim().isEmpty()) n = Build.MODEL;
        return "Резонанс OS · " + n.trim();
    }

    JSONObject about() {
        JSONObject o = new JSONObject();
        try {
            o.put("proto", PROTO);
            o.put("id", id);
            o.put("name", name());
            o.put("port", PORT);
            DisplayMetrics m = new DisplayMetrics();
            WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
            if (wm != null) {
                wm.getDefaultDisplay().getRealMetrics(m);
                o.put("w", Math.max(m.widthPixels, m.heightPixels));
                o.put("h", Math.min(m.widthPixels, m.heightPixels));
            }
        } catch (Exception ignored) {
        }
        return o;
    }

    // ---------- being found ----------

    private void announce() {
        try {
            NsdManager nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
            if (nsd == null) return;
            NsdServiceInfo s = new NsdServiceInfo();
            String n = name();
            // a DNS label is at most 63 bytes (Cyrillic letters are two each)
            while (n.getBytes(StandardCharsets.UTF_8).length > 60) n = n.substring(0, n.length() - 1);
            s.setServiceName(n);
            s.setServiceType(TYPE);
            s.setPort(PORT);
            s.setAttribute("id", id);
            s.setAttribute("proto", String.valueOf(PROTO));
            nsd.registerService(s, NsdManager.PROTOCOL_DNS_SD, new NsdManager.RegistrationListener() {
                @Override
                public void onServiceRegistered(NsdServiceInfo i) {
                    Log.i(TAG, "connect: объявлен в сети как «" + i.getServiceName() + "»");
                }

                @Override
                public void onRegistrationFailed(NsdServiceInfo i, int code) {
                    Log.w(TAG, "connect: NSD не объявил (" + code + ")");
                }

                @Override
                public void onServiceUnregistered(NsdServiceInfo i) {
                }

                @Override
                public void onUnregistrationFailed(NsdServiceInfo i, int code) {
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "connect: NSD: " + e);
        }
    }

    // "REZCONNECT?" by broadcast from a computer: the answer is this TV's card
    private void answerFinders() {
        while (true) {
            try (DatagramSocket s = new DatagramSocket(null)) {
                s.setReuseAddress(true);
                s.setBroadcast(true);
                s.bind(new InetSocketAddress(FIND_PORT));
                byte[] buf = new byte[512];
                while (true) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    String q = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                    if (!q.startsWith("REZCONNECT?") || !isLocal(p.getAddress())) continue;
                    byte[] a = ("REZCONNECT!" + about().toString()).getBytes(StandardCharsets.UTF_8);
                    s.send(new DatagramPacket(a, a.length, p.getAddress(), p.getPort()));
                }
            } catch (Exception e) {
                Log.w(TAG, "connect: поиск по UDP: " + e);
                try {
                    Thread.sleep(10000);
                } catch (InterruptedException ie) {
                    return;
                }
            }
        }
    }

    /** Only the home network: private, link-local and the box itself. */
    static boolean isLocal(InetAddress a) {
        if (a == null) return false;
        if (a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()) return true;
        byte[] b = a.getAddress();
        // IPv6 unique local (fc00::/7); IPv4-mapped private ones come as Inet4Address already
        return b.length == 16 && (b[0] & 0xfe) == 0xfc;
    }

    // ---------- the HTTP server ----------

    private void serve() {
        while (true) {
            try (ServerSocket ss = new ServerSocket()) {
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(PORT), 8);
                Log.i(TAG, "connect: жду компьютеры на порту " + PORT);
                while (true) {
                    final Socket s = ss.accept();
                    pool.execute(() -> handle(s));
                }
            } catch (Exception e) {
                Log.w(TAG, "connect: сервер: " + e);
                try {
                    Thread.sleep(5000);
                } catch (InterruptedException ie) {
                    return;
                }
            }
        }
    }

    private void handle(Socket s) {
        try {
            s.setSoTimeout(10000);
            InetAddress from = s.getInetAddress();
            if (!isLocal(from)) {
                s.close();
                return;
            }
            InputStream in = s.getInputStream();
            String head = readHead(in);
            if (head == null) {
                reply(s, 400, err("bad"));
                return;
            }
            String[] lines = head.split("\r\n");
            String[] rq = lines[0].split(" ");
            if (rq.length < 2) {
                reply(s, 400, err("bad"));
                return;
            }
            String method = rq[0];
            String path = rq[1];
            int len = 0;
            for (int i = 1; i < lines.length; i++) {
                String l = lines[i];
                int c = l.indexOf(':');
                if (c < 0) continue;
                String k = l.substring(0, c).trim().toLowerCase(Locale.ROOT);
                String v = l.substring(c + 1).trim();
                if (k.equals("content-length")) len = Integer.parseInt(v);
                // a web page in some browser on the network may not talk to the TV
                if (k.equals("origin")) {
                    reply(s, 403, err("origin"));
                    return;
                }
            }
            if (len < 0 || len > 256 * 1024) {
                reply(s, 413, err("big"));
                return;
            }
            byte[] body = new byte[len];
            int got = 0;
            while (got < len) {
                int n = in.read(body, got, len - got);
                if (n < 0) break;
                got += n;
            }
            JSONObject q = len > 0 ? new JSONObject(new String(body, 0, got, StandardCharsets.UTF_8)) : new JSONObject();
            String ip = from.getHostAddress();
            if (method.equals("GET") && path.equals("/connect/info")) reply(s, 200, about());
            else if (method.equals("POST") && path.equals("/connect/hello")) hello(s, q);
            else if (method.equals("POST") && path.equals("/connect/offer")) offer(s, q, ip);
            else if (method.equals("POST") && path.equals("/connect/bye")) bye(s, q);
            else reply(s, 404, err("path"));
        } catch (Exception e) {
            Log.w(TAG, "connect: запрос: " + e);
            try {
                reply(s, 400, err("bad"));
            } catch (Exception ignored) {
            }
        } finally {
            try {
                s.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        int state = 0;
        while ((c = in.read()) >= 0) {
            b.write(c);
            if (b.size() > 16384) return null;
            // \r\n\r\n
            if ((state == 0 || state == 2) && c == '\r') state++;
            else if ((state == 1 || state == 3) && c == '\n') state++;
            else state = c == '\r' ? 1 : 0;
            if (state == 4) return new String(b.toByteArray(), StandardCharsets.UTF_8).trim();
        }
        return null;
    }

    private static void reply(Socket s, int code, JSONObject o) throws IOException {
        byte[] body = o.toString().getBytes(StandardCharsets.UTF_8);
        String status = code == 200 ? "OK" : "Error";
        String head = "HTTP/1.1 " + code + " " + status + "\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " + body.length
            + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        OutputStream out = s.getOutputStream();
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static JSONObject err(String why) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("error", why);
        } catch (Exception ignored) {
        }
        return o;
    }

    private static String clean(String s, int max) {
        if (s == null) return "";
        s = s.replaceAll("[\\p{Cntrl}]", " ").trim();
        return s.length() > max ? s.substring(0, max) : s;
    }

    // ---------- the steps ----------

    private void hello(Socket s, JSONObject q) throws Exception {
        String from = clean(q.optString("from"), 80);
        String name = clean(q.optString("name"), 60);
        if (from.isEmpty()) {
            reply(s, 400, err("from"));
            return;
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("id", id);
        o.put("name", name());
        if (pairing.isKnown(from) && !q.optBoolean("again")) {
            o.put("paired", true);
        } else {
            String code = pairing.codeFor(from, System.currentTimeMillis());
            JSONObject e = new JSONObject();
            e.put("t", "code");
            e.put("code", code);
            e.put("name", name.isEmpty() ? "Компьютер" : name);
            deliver(e);
            o.put("paired", false);
        }
        reply(s, 200, o);
    }

    // the one picture being shown now: the page's answer comes back through answer()
    private final Object lock = new Object();
    private int sid = 0;
    private CountDownLatch waiting;
    private String answerSdp;
    private String answerErr;
    private String castFrom;

    private void offer(Socket s, JSONObject q, String ip) throws Exception {
        String from = clean(q.optString("from"), 80);
        String name = clean(q.optString("name"), 60);
        String sdp = q.optString("sdp", "");
        if (from.isEmpty() || sdp.isEmpty() || !sdp.startsWith("v=0")) {
            reply(s, 400, err("bad"));
            return;
        }
        long now = System.currentTimeMillis();
        String token = null;
        boolean ok = pairing.tryToken(from, q.optString("token", ""), now);
        if (!ok && q.has("code")) {
            boolean had = pairing.shownCode(now) != null;
            token = pairing.tryCode(from, name, q.optString("code"), now);
            ok = token != null;
            if (ok) savePairing();
            else {
                reply(s, 403, err(had ? "code" : "expired"));
                if (had && pairing.shownCode(now) == null) {
                    JSONObject e = new JSONObject();
                    e.put("t", "nocode");
                    deliver(e);
                }
                return;
            }
        }
        if (!ok) {
            reply(s, 403, err("pair"));
            return;
        }
        CountDownLatch l = new CountDownLatch(1);
        int my;
        synchronized (lock) {
            my = ++sid;
            if (waiting != null) waiting.countDown();
            waiting = l;
            answerSdp = null;
            answerErr = null;
            castFrom = from;
        }
        JSONObject e = new JSONObject();
        e.put("t", "offer");
        e.put("sid", my);
        e.put("sdp", sdp);
        e.put("ip", ip);
        e.put("name", name.isEmpty() ? pairing.nameOf(from) : name);
        deliver(e);
        Log.i(TAG, "connect: «" + name + "» (" + ip + ") показывает экран");
        // the box may need a moment to bring the page up
        boolean got = l.await(20, TimeUnit.SECONDS);
        String a;
        String why;
        synchronized (lock) {
            if (sid != my) {
                got = false;
                answerErr = "replaced";
            }
            a = answerSdp;
            why = answerErr;
            if (waiting == l) waiting = null;
        }
        if (!got || a == null) {
            reply(s, got ? 409 : 504, err(why != null ? why : "timeout"));
            return;
        }
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("sdp", a);
        if (token != null) o.put("token", token);
        reply(s, 200, o);
    }

    private void bye(Socket s, JSONObject q) throws Exception {
        String from = clean(q.optString("from"), 80);
        if (!pairing.tryToken(from, q.optString("token", ""), System.currentTimeMillis())) {
            reply(s, 403, err("pair"));
            return;
        }
        synchronized (lock) {
            if (!from.equals(castFrom)) {
                reply(s, 200, new JSONObject().put("ok", true));
                return;
            }
        }
        deliver(new JSONObject().put("t", "bye"));
        JSONObject o = new JSONObject();
        o.put("ok", true);
        reply(s, 200, o);
    }

    // ---------- from the page ----------

    void answer(int forSid, String sdp, String why) {
        synchronized (lock) {
            if (forSid != sid || waiting == null) return;
            answerSdp = sdp;
            answerErr = why;
            waiting.countDown();
        }
    }

    /** Back on the code screen: that code is no longer good. */
    void cancelCode() {
        pairing.dropCode();
    }

    // ---------- to the page ----------

    private final List<String> pending = new ArrayList<>();

    /** An event for the page («connect»); the home screen comes up first if an app is in front. */
    private void deliver(JSONObject e) {
        final String json = e.toString();
        ui.post(() -> {
            MainActivity a = MainActivity.current;
            if (a != null && a.isVisible() && a.web != null) {
                a.emit("connect", json);
                return;
            }
            synchronized (pending) {
                pending.add(json);
                while (pending.size() > 6) pending.remove(0);
            }
            front();
        });
    }

    /** What came while the page wasn't on the screen (it asks when it is again). */
    String takePending() {
        org.json.JSONArray a = new org.json.JSONArray();
        synchronized (pending) {
            for (String j : pending) {
                try {
                    a.put(new JSONObject(j));
                } catch (Exception ignored) {
                }
            }
            pending.clear();
        }
        return a.toString();
    }

    private void front() {
        Page.All.finishDreams();
        try {
            Intent i = new Intent(ctx, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            i.putExtra("connect", true);
            ctx.startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "connect: не вывел Резонанс OS на экран: " + e);
        }
    }
}
