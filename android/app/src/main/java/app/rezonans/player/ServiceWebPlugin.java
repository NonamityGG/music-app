package app.rezonans.player;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A small in-app browser per music service. Shown when the user signs in (or the
 * service asks to confirm they are not a robot); hidden the rest of the time,
 * when the app makes the service's own web requests from inside its site, so the
 * service sees an ordinary signed-in browser tab.
 */
@CapacitorPlugin(name = "ServiceWeb")
public class ServiceWebPlugin extends Plugin {

    private static class Holder {
        String service;
        WebView web;
        LinearLayout panel;
        TextView title;
        boolean loading = true;
        String url = "";
        String watch = null; // close by itself once the address contains this
        final List<Runnable> waiting = new ArrayList<>();
    }

    private final Map<String, Holder> holders = new HashMap<>();
    private final Map<String, PluginCall> calls = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    private void checkWatch(Holder h, String url) {
        if (h.watch == null || url == null || !url.contains(h.watch)) return;
        h.watch = null;
        JSObject ev = new JSObject();
        ev.put("service", h.service);
        ev.put("url", url);
        notifyListeners("match", ev);
        h.url = url;
        if (h.panel.getVisibility() == View.VISIBLE) close(h, true);
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics()));
    }

    public class Bridge {

        @JavascriptInterface
        public void onResult(String id, String json) {
            PluginCall call = calls.remove(id);
            if (call == null) return;
            try {
                call.resolve(new JSObject(json));
            } catch (JSONException e) {
                call.reject("Непонятный ответ страницы");
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private Holder holder(String service) {
        Holder h = holders.get(service);
        if (h != null) return h;
        h = new Holder();
        h.service = service;
        final Holder hh = h;

        WebView web = new WebView(getActivity());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        // look like the phone's Chrome, not like an embedded view
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "RezonansBridge");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(
            new WebViewClient() {
                @Override
                public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                    checkWatch(hh, url);
                }

                @Override
                public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                    checkWatch(hh, url);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    checkWatch(hh, url);
                    hh.loading = false;
                    hh.url = url;
                    CookieManager.getInstance().flush();
                    List<Runnable> run = new ArrayList<>(hh.waiting);
                    hh.waiting.clear();
                    for (Runnable r : run) r.run();
                    JSObject ev = new JSObject();
                    ev.put("service", hh.service);
                    ev.put("url", url);
                    notifyListeners("page", ev);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    checkWatch(hh, uri.toString());
                    String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                    if (scheme.equals("http") || scheme.equals("https")) return false;
                    // e.g. sign-in through the bank's app
                    try {
                        Intent intent = scheme.equals("intent") ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, uri);
                        getActivity().startActivity(intent);
                    } catch (Exception ignored) {}
                    return true;
                }
            }
        );

        LinearLayout panel = new LinearLayout(getActivity());
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(Color.parseColor("#140F1F"));

        LinearLayout bar = new LinearLayout(getActivity());
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(8), dp(8));
        TextView title = new TextView(getActivity());
        title.setTextColor(Color.parseColor("#F2EDFF"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bar.addView(title, tl);
        Button done = new Button(getActivity());
        done.setText("Готово");
        done.setAllCaps(false);
        done.setTextColor(Color.parseColor("#1B1030"));
        done.setBackgroundColor(Color.parseColor("#B79CFF"));
        done.setOnClickListener(v -> close(hh, true));
        bar.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        panel.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        ViewCompat.setOnApplyWindowInsetsListener(panel, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        panel.setVisibility(View.INVISIBLE);

        ViewGroup root = getActivity().findViewById(android.R.id.content);
        root.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.requestApplyInsets(panel);

        h.web = web;
        h.panel = panel;
        h.title = title;
        holders.put(service, h);
        return h;
    }

    private void close(Holder h, boolean byUser) {
        h.panel.setVisibility(View.INVISIBLE);
        if (byUser) {
            JSObject ev = new JSObject();
            ev.put("service", h.service);
            ev.put("url", h.url);
            notifyListeners("closed", ev);
        }
    }

    /** Opens (or re-opens) a service page. visible=true shows it full screen with a "Готово" button. */
    @PluginMethod
    public void open(PluginCall call) {
        String service = call.getString("service", "default");
        String url = call.getString("url");
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", false));
        String title = call.getString("title", "");
        String watch = call.getString("watch", "");
        main.post(() -> {
            Holder h = holder(service);
            h.watch = watch == null || watch.isEmpty() ? null : watch;
            if (url != null && !url.isEmpty()) {
                h.loading = true;
                h.web.loadUrl(url);
            }
            h.title.setText(title);
            if (visible) {
                h.panel.setVisibility(View.VISIBLE);
                h.panel.bringToFront();
                ViewCompat.requestApplyInsets(h.panel);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        String service = call.getString("service", "default");
        main.post(() -> {
            Holder h = holders.get(service);
            if (h != null) close(h, false);
            call.resolve();
        });
    }

    /** Android back button: steps back inside an open panel, or closes it. */
    @PluginMethod
    public void back(PluginCall call) {
        main.post(() -> {
            JSObject r = new JSObject();
            r.put("handled", false);
            for (Holder h : holders.values()) {
                if (h.panel.getVisibility() != View.VISIBLE) continue;
                if (h.web.canGoBack()) h.web.goBack();
                else close(h, true);
                r.put("handled", true);
                break;
            }
            call.resolve(r);
        });
    }

    /** Is the panel open on screen? */
    @PluginMethod
    public void state(PluginCall call) {
        String service = call.getString("service", "default");
        main.post(() -> {
            Holder h = holders.get(service);
            JSObject r = new JSObject();
            r.put("exists", h != null);
            r.put("visible", h != null && h.panel.getVisibility() == View.VISIBLE);
            r.put("url", h != null ? h.url : "");
            r.put("loading", h != null && h.loading);
            call.resolve(r);
        });
    }

    /** Runs fetch() inside the service page, with its cookies, and returns { status, body, url }. */
    @PluginMethod
    public void request(PluginCall call) {
        String service = call.getString("service", "default");
        int timeout = call.getInt("timeout", 25000);
        boolean xhr = "xhr".equals(call.getString("mode", "fetch"));
        JSONObject opts = new JSONObject();
        try {
            opts.put("url", call.getString("url"));
            opts.put("method", call.getString("method", "GET"));
            JSObject headers = call.getObject("headers", new JSObject());
            opts.put("headers", headers);
            String body = call.getString("body");
            if (body != null) opts.put("body", body);
            opts.put("timeout", timeout);
        } catch (JSONException e) {
            call.reject("bad request");
            return;
        }
        String id = UUID.randomUUID().toString();
        calls.put(id, call);
        String head = "(function(){var id=" + JSONObject.quote(id) + ";var o=" + opts.toString() + ";" +
            "function done(v){try{RezonansBridge.onResult(id,JSON.stringify(v));}catch(e){}}";
        String js = xhr
            ? head +
              "try{var x=new XMLHttpRequest();x.open(o.method,o.url,true);x.withCredentials=true;x.timeout=o.timeout;" +
              "for(var k in o.headers){try{x.setRequestHeader(k,o.headers[k]);}catch(e){}}" +
              "x.onload=function(){done({status:x.status,body:x.responseText,url:x.responseURL,type:x.getResponseHeader('content-type')||''});};" +
              "x.onerror=function(){done({status:0,error:'xhr error'});};" +
              "x.ontimeout=function(){done({status:0,error:'timeout'});};" +
              "x.send(o.body===undefined?null:o.body);}catch(e){done({status:0,error:String(e)});}})();"
            : head +
              "var c=typeof AbortController!=='undefined'?new AbortController():null;" +
              "var t=setTimeout(function(){if(c)c.abort();},o.timeout);" +
              "fetch(o.url,{method:o.method,headers:o.headers,body:o.body,credentials:'include',signal:c?c.signal:undefined})" +
              ".then(function(r){return r.text().then(function(x){clearTimeout(t);done({status:r.status,body:x,url:r.url,type:r.headers.get('content-type')||''});});})" +
              ".catch(function(e){clearTimeout(t);done({status:0,error:String(e)});});})();";
        main.post(() -> {
            Holder h = holder(service);
            Runnable go = () -> h.web.evaluateJavascript(js, null);
            if (h.loading) h.waiting.add(go);
            else go.run();
        });
        main.postDelayed(() -> {
            PluginCall c = calls.remove(id);
            if (c != null) {
                JSObject r = new JSObject();
                r.put("status", 0);
                r.put("error", "timeout");
                c.resolve(r);
            }
        }, timeout + 5000L);
    }

    /** Runs a script in the service page once it has loaded; resolves { value } (JSON of the result). */
    @PluginMethod
    public void run(PluginCall call) {
        String service = call.getString("service", "default");
        String js = call.getString("js", "null");
        main.post(() -> {
            Holder h = holder(service);
            Runnable go = () ->
                h.web.evaluateJavascript(js, (value) -> {
                    JSObject r = new JSObject();
                    r.put("value", value);
                    call.resolve(r);
                });
            if (h.loading) h.waiting.add(go);
            else go.run();
        });
    }

    /** Signs the service out by dropping the cookies of its domains. */
    @PluginMethod
    public void forget(PluginCall call) {
        String domains = call.getString("domains", "");
        main.post(() -> {
            CookieManager cm = CookieManager.getInstance();
            for (String d : domains.split(",")) {
                d = d.trim();
                if (d.isEmpty()) continue;
                String all = cm.getCookie("https://" + d);
                if (all == null) continue;
                for (String part : all.split(";")) {
                    String name = part.split("=")[0].trim();
                    cm.setCookie("https://" + d, name + "=; Max-Age=0; Path=/");
                    cm.setCookie("https://" + d, name + "=; Max-Age=0; Path=/; Domain=." + d);
                }
            }
            cm.flush();
            call.resolve();
        });
    }
}
