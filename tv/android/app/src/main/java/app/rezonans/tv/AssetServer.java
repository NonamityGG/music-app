package app.rezonans.tv;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Serves the page from a private https address (the one Android reserves for
 * app assets): the web part from assets/www, app icons and banners at /icon/,
 * the cover of what's playing at /art, and a few outside services (the
 * weather, the words of songs) at /net?u=… — fetched here rather than by the
 * page, so the box's old browser engine, its certificates or CORS can't get in
 * the way.
 */
final class AssetServer {
    static final String HOST = "appassets.androidplatform.net";
    static final String BASE = "https://" + HOST + "/";

    private AssetServer() {
    }

    static boolean isOurs(Uri u) {
        return u != null && HOST.equals(u.getHost());
    }

    static WebResourceResponse serve(Context c, Uri u) {
        if (!isOurs(u)) return null;
        String p = u.getPath();
        if (p == null || p.isEmpty() || p.equals("/")) p = "/index.html";
        try {
            if (p.startsWith("/icon/")) {
                String pkg = p.substring(6);
                byte[] png = Icons.get(c, pkg, "banner".equals(u.getQueryParameter("k")));
                return png == null ? missing() : bytes("image/png", png, "max-age=86400");
            }
            if (p.equals("/net")) return net(u.getQueryParameter("u"));
            if (p.startsWith("/art")) {
                byte[] jpg = MediaHub.artJpeg();
                return jpg == null ? missing() : bytes("image/jpeg", jpg, "no-cache");
            }
            InputStream in = c.getAssets().open("www" + p);
            return stream(mime(p), in, p.endsWith(".html") ? "no-cache" : "max-age=31536000");
        } catch (IOException e) {
            return missing();
        }
    }

    // only these, and only for reading
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList(
        "api.open-meteo.com", "geocoding-api.open-meteo.com", "nominatim.openstreetmap.org",
        "get.geojs.io", "ipwho.is", "api.sypexgeo.net", "ipapi.co", "freeipapi.com", "ipinfo.io",
        "lrclib.net"));
    private static final String UA = "RezonansOS/1.0 (Android TV; https://github.com/NonamityGG/music-app)";

    private static WebResourceResponse net(String target) {
        if (target == null) return missing();
        Uri t = Uri.parse(target);
        if (!"https".equals(t.getScheme()) || !HOSTS.contains(t.getHost())) return missing();
        HttpURLConnection h = null;
        try {
            h = (HttpURLConnection) new URL(target).openConnection();
            h.setConnectTimeout(7000);
            h.setReadTimeout(12000);
            h.setRequestProperty("User-Agent", UA);
            h.setRequestProperty("Lrclib-Client", UA);
            h.setRequestProperty("Accept", "application/json");
            h.setRequestProperty("Accept-Language", "ru,en;q=0.5");
            int code = h.getResponseCode();
            InputStream in = code >= 400 ? h.getErrorStream() : h.getInputStream();
            byte[] body = new byte[0];
            if (in != null) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0 && out.size() < 4 * 1024 * 1024) out.write(buf, 0, n);
                in.close();
                body = out.toByteArray();
            }
            if (code >= 300 && code < 400) code = 502; // not followed across sites
            if (code >= 400) Log.w(MainActivity.TAG, "net " + t.getHost() + ": HTTP " + code);
            return new WebResourceResponse("application/json", "utf-8", code, code < 300 ? "OK" : "Error", headers("no-store"), new ByteArrayInputStream(body));
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "net " + t.getHost() + ": " + e);
            return new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", headers("no-store"), new ByteArrayInputStream(String.valueOf(e).getBytes()));
        } finally {
            if (h != null) h.disconnect();
        }
    }

    private static Map<String, String> headers(String cache) {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        h.put("Cache-Control", cache);
        return h;
    }

    private static WebResourceResponse bytes(String mime, byte[] b, String cache) {
        return stream(mime, new ByteArrayInputStream(b), cache);
    }

    private static WebResourceResponse stream(String mime, InputStream in, String cache) {
        String enc = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") ? "utf-8" : null;
        return new WebResourceResponse(mime, enc, 200, "OK", headers(cache), in);
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers("no-cache"), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".woff2")) return "font/woff2";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".webp")) return "image/webp";
        if (l.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }
}
