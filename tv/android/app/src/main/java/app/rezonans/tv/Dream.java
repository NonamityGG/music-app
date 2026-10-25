package app.rezonans.tv;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.service.dreams.DreamService;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * The screen saver of the whole box: when the TV has been left alone (over any
 * app, music playing in Звук or a film on pause), the system starts this
 * instead of its own saver. The same page as the home screen, opened straight
 * into its screen saver (index.html#dream). Any key ends it.
 */
public class Dream extends DreamService implements Page {
    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean on = false;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        setScreenBright(true);
        try {
            web = new WebView(this);
        } catch (Throwable e) {
            Log.w(MainActivity.TAG, "dream: no WebView: " + e);
            finish();
            return;
        }
        web.setBackgroundColor(Color.rgb(15, 11, 22));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.addJavascriptInterface(new JsBridge(), "RezTV");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return AssetServer.serve(Dream.this, request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !AssetServer.isOurs(request.getUrl());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                Log.w(MainActivity.TAG, "dream: page gone");
                web = null;
                finish();
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(AssetServer.BASE + "index.html#dream");
        Page.All.add(this);
        MediaHub.attach(this);
        Log.i(MainActivity.TAG, "заставка Резонанс OS поверх приложений");
    }

    @Override
    public void onDreamingStarted() {
        super.onDreamingStarted();
        on = true;
        emit("visible", "true");
        MediaHub.refresh(this);
        Viz.resume(this);
    }

    @Override
    public void onDreamingStopped() {
        on = false;
        Viz.stopFor(this);
        super.onDreamingStopped();
    }

    @Override
    public void onDetachedFromWindow() {
        on = false;
        Page.All.remove(this);
        Viz.stopFor(this);
        if (web != null) {
            web.removeJavascriptInterface("RezTV");
            web.destroy();
            web = null;
        }
        super.onDetachedFromWindow();
    }

    // ---------- Page ----------

    @Override
    public void emit(final String name, final String json) {
        ui.post(() -> {
            if (web == null) return;
            web.evaluateJavascript("window.__rezEmit&&window.__rezEmit(" + JSONObject.quote(name) + "," + (json == null ? "null" : json) + ")", null);
        });
    }

    @Override
    public boolean isVisible() {
        return on;
    }

    @Override
    public Context context() {
        return this;
    }

    /** What the screen saver page may ask: only looking, nothing to open or change. */
    final class JsBridge {
        @JavascriptInterface
        public String apps() {
            return "[]";
        }

        @JavascriptInterface
        public String info() {
            return Bridge.info(Dream.this);
        }

        @JavascriptInterface
        public String network() {
            return Bridge.network(Dream.this);
        }

        @JavascriptInterface
        public String mediaState() {
            return MediaHub.json();
        }

        @JavascriptInterface
        public void media(String action) {
            MediaHub.action(action);
        }

        @JavascriptInterface
        public void visualizer(boolean want) {
            ui.post(() -> {
                if (want && on) Viz.resume(Dream.this);
                else Viz.stopFor(Dream.this);
            });
        }

        @JavascriptInterface
        public void log(String msg) {
            Log.i(MainActivity.TAG, "заставка: " + msg);
        }

        @JavascriptInterface
        public void dreamDone() {
            ui.post(Dream.this::finish);
        }
    }
}
