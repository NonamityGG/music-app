package app.rezonans.tv;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Резонанс Connect for boxes that let nothing in. Some boxes (SberBox) drop
 * every connection or packet a computer starts towards an ordinary app — only
 * the system's own mDNS hears the network. So the TV goes out instead: it
 * watches (through the system's NSD) for a computer announcing
 * _rezonans-pc._tcp — Резонанс для ПК does while «На телевизор» is open or the
 * picture goes — and connects to it. The same requests as over HTTP then come
 * down that connection, one JSON per line:
 *
 *   TV -> PC  {"t":"tv", proto, id, name, w, h}            once, first
 *   PC -> TV  {"t":"req", rid, method, path, body}
 *   TV -> PC  {"t":"res", rid, status, body}
 *
 * Only computers on the local network; the pairing rules are the same.
 */
final class Dialer {
    static final String TYPE = "_rezonans-pc._tcp";
    private static final String TAG = MainActivity.TAG;

    private final Context ctx;
    private final Connect connect;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private NsdManager nsd;

    // computers seen now: service name -> its link (or null while connecting)
    private final Map<String, Link> links = new HashMap<>();
    // NSD resolves one at a time on older Android
    private final ArrayDeque<NsdServiceInfo> toResolve = new ArrayDeque<>();
    private boolean resolving = false;

    Dialer(Context c, Connect connect) {
        ctx = c;
        this.connect = connect;
    }

    void start() {
        try {
            nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
            if (nsd == null) return;
            nsd.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, new NsdManager.DiscoveryListener() {
                @Override
                public void onDiscoveryStarted(String type) {
                    Log.i(TAG, "connect: ищу компьютеры с Резонансом в сети");
                }

                @Override
                public void onServiceFound(NsdServiceInfo s) {
                    synchronized (links) {
                        if (links.containsKey(s.getServiceName())) return;
                        links.put(s.getServiceName(), null);
                    }
                    resolve(s);
                }

                @Override
                public void onServiceLost(NsdServiceInfo s) {
                    Link l;
                    synchronized (links) {
                        l = links.remove(s.getServiceName());
                    }
                    if (l != null) l.close();
                }

                @Override
                public void onDiscoveryStopped(String type) {
                }

                @Override
                public void onStartDiscoveryFailed(String type, int code) {
                    Log.w(TAG, "connect: поиск компьютеров не начался (" + code + ")");
                }

                @Override
                public void onStopDiscoveryFailed(String type, int code) {
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "connect: поиск компьютеров: " + e);
        }
    }

    private void resolve(NsdServiceInfo s) {
        synchronized (toResolve) {
            toResolve.add(s);
            if (resolving) return;
            resolving = true;
        }
        next();
    }

    private void next() {
        NsdServiceInfo s;
        synchronized (toResolve) {
            s = toResolve.poll();
            if (s == null) {
                resolving = false;
                return;
            }
        }
        try {
            nsd.resolveService(s, new NsdManager.ResolveListener() {
                @Override
                public void onServiceResolved(NsdServiceInfo r) {
                    final String name = r.getServiceName();
                    final InetAddress host = r.getHost();
                    final int port = r.getPort();
                    pool.execute(() -> dial(name, host, port));
                    next();
                }

                @Override
                public void onResolveFailed(NsdServiceInfo r, int code) {
                    Log.w(TAG, "connect: не узнал адрес «" + r.getServiceName() + "» (" + code + ")");
                    synchronized (links) {
                        links.remove(r.getServiceName());
                    }
                    next();
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "connect: resolve: " + e);
            next();
        }
    }

    // goes out to the computer; tries again a few times while it is still seen
    private void dial(String name, InetAddress host, int port) {
        if (host == null || !Connect.isLocal(host) || port <= 0) {
            synchronized (links) {
                links.remove(name);
            }
            return;
        }
        for (int attempt = 0; attempt < 6; attempt++) {
            synchronized (links) {
                if (!links.containsKey(name)) return; // gone from the network
            }
            Link l = new Link(name, host, port);
            try {
                l.open();
                synchronized (links) {
                    if (!links.containsKey(name)) {
                        l.close();
                        return;
                    }
                    links.put(name, l);
                }
                Log.i(TAG, "connect: на связи с «" + name + "» (" + host.getHostAddress() + ")");
                l.serve(); // until the computer closes it
                Log.i(TAG, "connect: «" + name + "» отключился");
                attempt = 0;
            } catch (Exception e) {
                Log.w(TAG, "connect: «" + name + "»: " + e);
            } finally {
                l.close();
                synchronized (links) {
                    if (links.get(name) == l) links.put(name, null);
                }
            }
            try {
                Thread.sleep(2000L * (attempt + 1));
            } catch (InterruptedException ie) {
                return;
            }
        }
        synchronized (links) {
            links.remove(name);
        }
    }

    private final class Link {
        final String name;
        final InetAddress host;
        final int port;
        private Socket sock;
        private OutputStream out;

        Link(String name, InetAddress host, int port) {
            this.name = name;
            this.host = host;
            this.port = port;
        }

        void open() throws Exception {
            sock = new Socket();
            sock.connect(new InetSocketAddress(host, port), 5000);
            sock.setTcpNoDelay(true);
            sock.setKeepAlive(true);
            out = sock.getOutputStream();
            JSONObject hi = connect.about();
            hi.put("t", "tv");
            write(hi);
        }

        synchronized void write(JSONObject o) throws Exception {
            out.write((o.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        }

        void serve() throws Exception {
            BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8), 16384);
            String line;
            while ((line = in.readLine()) != null) {
                if (line.length() > 512 * 1024) break;
                final JSONObject m = new JSONObject(line);
                if (!"req".equals(m.optString("t"))) continue;
                final long rid = m.optLong("rid");
                // an offer waits for the page: each request on its own thread
                pool.execute(() -> {
                    try {
                        JSONObject body = m.optJSONObject("body");
                        connect.route((code, o) -> {
                            try {
                                JSONObject r = new JSONObject();
                                r.put("t", "res");
                                r.put("rid", rid);
                                r.put("status", code);
                                r.put("body", o);
                                write(r);
                            } catch (Exception e) {
                                throw new java.io.IOException(e);
                            }
                        }, m.optString("method", "POST"), m.optString("path"), body == null ? new JSONObject() : body, host.getHostAddress());
                    } catch (Exception e) {
                        Log.w(TAG, "connect: запрос по связи: " + e);
                    }
                });
            }
        }

        void close() {
            try {
                if (sock != null) sock.close();
            } catch (Exception ignored) {
            }
        }
    }
}
