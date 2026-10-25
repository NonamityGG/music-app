package app.rezonans.tv;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves the page from a private https address (the one Android reserves for
 * app assets): the web part from assets/www, app icons and banners at /icon/,
 * the cover of what's playing at /art.
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
