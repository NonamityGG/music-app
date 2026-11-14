package app.rezonans.player;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Резонанс Connect from the phone: the phone shows up on the home network the
 * way Резонанс для ПК does — it announces _rezonans-pc._tcp and waits, and a
 * TV running Резонанс OS connects to it (some boxes let nothing in, so the TV
 * always goes out). Then requests go to the TV down that connection, one JSON
 * per line:
 *
 *   TV -> phone  {"t":"tv", proto, id, name, w, h}   once, first
 *   phone -> TV  {"t":"req", rid, method, path, body}
 *   TV -> phone  {"t":"res", rid, status, body}
 *
 * Only addresses of the local network are let in.
 */
final class CastPresence {
    static final String TYPE = "_rezonans-pc._tcp";
    private static final String TAG = "RezCast";

    interface Listener {
        void onTv(JSONObject tv);

        void onGone(String id);
    }

    private final Context ctx;
    private final String id;
    private final String name;
    private final Listener listener;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, Link> tvs = new HashMap<>();
    private final AtomicLong rid = new AtomicLong();
    private ServerSocket server;
    private NsdManager nsd;
    private NsdManager.RegistrationListener reg;
    private volatile boolean closed = false;

    CastPresence(Context c, String id, String name, Listener l) {
        ctx = c.getApplicationContext();
        this.id = id;
        this.name = name;
        listener = l;
    }

    static boolean isLocal(InetAddress a) {
        if (a == null) return false;
        if (a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress()) return true;
        if (a instanceof Inet6Address) return (a.getAddress()[0] & 0xfe) == 0xfc; // fc00::/7
        if (a instanceof Inet4Address) {
            byte[] b = a.getAddress();
            return (b[0] & 0xff) == 100 && (b[1] & 0xc0) == 64; // 100.64/10 (some routers)
        }
        return false;
    }

    void start() throws Exception {
        server = new ServerSocket(0);
        final int port = server.getLocalPort();
        pool.execute(this::accept);
        nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
        NsdServiceInfo s = new NsdServiceInfo();
        // the name is only what shows in network tools; the TV goes by the id
        String label = name.replaceAll("[^\\p{L}\\p{N} -]", "").trim();
        if (label.length() > 40) label = label.substring(0, 40);
        s.setServiceName((label.isEmpty() ? "Rezonans" : label) + "-" + id.substring(0, Math.min(6, id.length())));
        s.setServiceType(TYPE);
        s.setPort(port);
        s.setAttribute("id", id);
        s.setAttribute("proto", "1");
        reg = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo i) {
                Log.i(TAG, "жду телевизоры на порту " + port);
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo i, int code) {
                Log.w(TAG, "не объявился в сети (" + code + ")");
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo i) {
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo i, int code) {
            }
        };
        nsd.registerService(s, NsdManager.PROTOCOL_DNS_SD, reg);
    }

    private void accept() {
        while (!closed) {
            final Socket sock;
            try {
                sock = server.accept();
            } catch (Exception e) {
                if (!closed) Log.w(TAG, "приём: " + e);
                return;
            }
            if (!isLocal(sock.getInetAddress())) {
                try {
                    sock.close();
                } catch (Exception ignored) {
                }
                continue;
            }
            pool.execute(() -> serve(sock));
        }
    }

    private void serve(Socket sock) {
        Link me = null;
        try {
            sock.setTcpNoDelay(true);
            sock.setKeepAlive(true);
            BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8), 16384);
            OutputStream out = sock.getOutputStream();
            String line;
            while ((line = in.readLine()) != null) {
                if (line.length() > 2 * 1024 * 1024) break;
                JSONObject m;
                try {
                    m = new JSONObject(line);
                } catch (Exception e) {
                    continue;
                }
                String t = m.optString("t");
                if ("tv".equals(t) && me == null && m.optString("id").length() > 0) {
                    JSONObject tv = new JSONObject();
                    tv.put("id", m.optString("id"));
                    tv.put("name", m.optString("name", "Резонанс OS"));
                    tv.put("ip", sock.getInetAddress().getHostAddress().replaceFirst("^::ffff:", "").replaceFirst("%.*$", ""));
                    tv.put("w", m.optInt("w"));
                    tv.put("h", m.optInt("h"));
                    tv.put("link", true);
                    me = new Link(tv, sock, out);
                    Link old;
                    synchronized (tvs) {
                        old = tvs.put(tv.getString("id"), me);
                    }
                    if (old != null) old.close();
                    Log.i(TAG, "«" + tv.optString("name") + "» на связи (" + tv.optString("ip") + ")");
                    listener.onTv(tv);
                } else if ("res".equals(t) && me != null) {
                    Link.Wait w;
                    synchronized (me.waiting) {
                        w = me.waiting.remove(m.optLong("rid"));
                    }
                    if (w != null) w.done(m.optInt("status"), m.optJSONObject("body"));
                }
            }
        } catch (Exception e) {
            if (!closed) Log.w(TAG, "связь с ТВ: " + e);
        } finally {
            if (me != null) {
                me.close();
                boolean was;
                synchronized (tvs) {
                    was = tvs.get(me.tv.optString("id")) == me;
                    if (was) tvs.remove(me.tv.optString("id"));
                }
                if (was && !closed) listener.onGone(me.tv.optString("id"));
            } else {
                try {
                    sock.close();
                } catch (Exception ignored) {
                }
            }
        }
    }

    List<JSONObject> tvs() {
        List<JSONObject> r = new ArrayList<>();
        synchronized (tvs) {
            for (Link l : tvs.values()) r.add(l.tv);
        }
        return r;
    }

    /** A request to a TV that came to us: {status, body}; status 0 when there is no answer. */
    JSONObject request(String tvId, String method, String path, JSONObject body, long timeoutMs) {
        Link l;
        synchronized (tvs) {
            l = tvs.get(tvId);
        }
        JSONObject r = new JSONObject();
        try {
            if (l == null) return fail(r, "net");
            long my = rid.incrementAndGet();
            Link.Wait w = new Link.Wait();
            synchronized (l.waiting) {
                l.waiting.put(my, w);
            }
            JSONObject q = new JSONObject();
            q.put("t", "req");
            q.put("rid", my);
            q.put("method", method);
            q.put("path", path);
            q.put("body", body == null ? new JSONObject() : body);
            try {
                l.write(q);
            } catch (Exception e) {
                synchronized (l.waiting) {
                    l.waiting.remove(my);
                }
                return fail(r, "net");
            }
            if (!w.latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                synchronized (l.waiting) {
                    l.waiting.remove(my);
                }
                return fail(r, "timeout");
            }
            if (w.status == 0) return fail(r, "net");
            r.put("status", w.status);
            r.put("body", w.body == null ? new JSONObject() : w.body);
            return r;
        } catch (Exception e) {
            return fail(r, "net");
        }
    }

    private static JSONObject fail(JSONObject r, String why) {
        try {
            r.put("status", 0);
            r.put("body", new JSONObject().put("ok", false).put("error", why));
        } catch (Exception ignored) {
        }
        return r;
    }

    void stop() {
        if (closed) return;
        closed = true;
        try {
            if (nsd != null && reg != null) nsd.unregisterService(reg);
        } catch (Exception ignored) {
        }
        try {
            if (server != null) server.close();
        } catch (Exception ignored) {
        }
        synchronized (tvs) {
            for (Link l : tvs.values()) l.close();
            tvs.clear();
        }
        pool.shutdownNow();
    }

    private static final class Link {
        final JSONObject tv;
        final Socket sock;
        final OutputStream out;
        final Map<Long, Wait> waiting = new HashMap<>();

        Link(JSONObject tv, Socket sock, OutputStream out) {
            this.tv = tv;
            this.sock = sock;
            this.out = out;
        }

        synchronized void write(JSONObject o) throws Exception {
            out.write((o.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        }

        void close() {
            synchronized (waiting) {
                for (Wait w : waiting.values()) w.done(0, null);
                waiting.clear();
            }
            try {
                sock.close();
            } catch (Exception ignored) {
            }
        }

        static final class Wait {
            final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
            volatile int status;
            volatile JSONObject body;

            void done(int s, JSONObject b) {
                status = s;
                body = b;
                latch.countDown();
            }
        }
    }
}
