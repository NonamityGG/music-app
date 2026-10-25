package app.rezonans.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * The home screen itself: one full-screen WebView with the Резонанс OS page
 * (assets/www), served from a private https address so the page behaves like a
 * normal site (storage, fetch for the weather). The remote's arrows and OK go
 * to the page as keyboard keys; Back, Menu and Home come as events.
 */
public class MainActivity extends Activity {

    static final String TAG = "RezTV";
    static volatile MainActivity current;

    WebView web;
    Bridge bridge;
    final Handler ui = new Handler(Looper.getMainLooper());
    private boolean visible = false;
    private BroadcastReceiver packages;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // the box's own screen saver doesn't come over Резонанс OS: it has its own.
        // After a long time without keys the page lets go (keepAwake(false)).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();

        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(15, 11, 22));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100); // the TV's font size setting must not break the layout
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        bridge = new Bridge(this);
        web.addJavascriptInterface(bridge, "RezTV");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return AssetServer.serve(MainActivity.this, request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // the page never navigates away
                return !AssetServer.isOurs(request.getUrl());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // the page crashed or was killed for memory: build it again
                Log.w(TAG, "render process gone, reloading");
                if (view.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                web = null;
                recreate();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "page: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(AssetServer.BASE + "index.html");
        web.requestFocus();

        MediaHub.attach(this);
        watchPackages();
    }

    private void immersive() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    // apps installed or removed: the rows are rebuilt
    private void watchPackages() {
        packages = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                Icons.forget(i.getData() != null ? i.getData().getSchemeSpecificPart() : null);
                emit("apps", "null");
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addAction(Intent.ACTION_PACKAGE_REPLACED);
        f.addDataScheme("package");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(packages, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(packages, f);
    }

    /** Sends an event to the page: window.__rezEmit(name, data). data is JSON. */
    void emit(final String name, final String json) {
        ui.post(() -> {
            if (web == null) return;
            web.evaluateJavascript("window.__rezEmit&&window.__rezEmit(" + JSONObject.quote(name) + "," + (json == null ? "null" : json) + ")", null);
        });
    }

    boolean isVisible() {
        return visible;
    }

    // OK on the remote, as one whole press: a short one, or held (the app's
    // menu). Remotes differ in what they send while a key is held, so the time
    // is measured here rather than in the page.
    volatile boolean typing = false;
    private boolean okDown = false;
    private boolean okLong = false;
    private final Runnable okHeld = () -> {
        if (okDown && !okLong) {
            okLong = true;
            emit("key", "\"long\"");
        }
    };

    private static boolean isOk(int k) {
        return k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER
            || k == KeyEvent.KEYCODE_BUTTON_SELECT || k == KeyEvent.KEYCODE_BUTTON_A;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (typing && isOk(k)) return super.dispatchKeyEvent(e);
        if (isOk(k)) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) {
                if (e.getRepeatCount() == 0) {
                    okDown = true;
                    okLong = false;
                    ui.removeCallbacks(okHeld);
                    ui.postDelayed(okHeld, 550);
                } else if (e.isLongPress()) {
                    okHeld.run();
                }
            } else if (e.getAction() == KeyEvent.ACTION_UP) {
                ui.removeCallbacks(okHeld);
                if (okDown && !okLong && !e.isCanceled()) emit("key", "\"ok\"");
                okDown = false;
            }
            return true;
        }
        // Back and Menu are the page's to handle (a home screen never closes)
        if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
            if (e.getAction() == KeyEvent.ACTION_UP && !e.isCanceled()) emit("key", "\"back\"");
            return true;
        }
        if (k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_SETTINGS || k == KeyEvent.KEYCODE_INFO) {
            if (e.getAction() == KeyEvent.ACTION_UP) emit("key", "\"menu\"");
            return true;
        }
        if (k == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE && e.getAction() == KeyEvent.ACTION_UP) {
            MediaHub.action("toggle");
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        emit("perm", "null");
        Viz.resume(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // the Home button while Резонанс OS is already in front: back to the top
        if (intent != null && intent.hasCategory(Intent.CATEGORY_HOME)) emit("key", "\"home\"");
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        visible = true;
        immersive();
        if (web != null) {
            web.resumeTimers();
            web.onResume();
        }
        emit("visible", "true");
        MediaHub.refresh(this);
        Viz.resume(this);
    }

    @Override
    protected void onPause() {
        visible = false;
        emit("visible", "false");
        Viz.stop();
        // an app is in front: the home screen sleeps (no drawing, no timers),
        // so the box's processor and memory are the app's
        final WebView w = web;
        if (w != null) {
            ui.postDelayed(() -> {
                if (!visible && web == w) {
                    w.onPause();
                    w.pauseTimers();
                }
            }, 400);
        }
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    protected void onDestroy() {
        try {
            if (packages != null) unregisterReceiver(packages);
        } catch (Exception ignored) {
        }
        Viz.stop();
        if (current == this) current = null;
        if (web != null) {
            web.removeJavascriptInterface("RezTV");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // never leave the home screen
    }
}
