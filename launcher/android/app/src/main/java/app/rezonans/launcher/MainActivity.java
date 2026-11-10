package app.rezonans.launcher;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
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
 * The home screen itself: one full-screen WebView with the Резонанс page
 * (assets/www), served from a private https address so the page behaves like a
 * normal site (storage, fetch). It is edge to edge (the page gets the sizes of
 * the system bars as events), and it is the phone's home app when chosen.
 */
public class MainActivity extends Activity implements Page {

    static final String TAG = "RezL";
    static volatile MainActivity current;

    WebView web;
    Bridge bridge;
    final Handler ui = new Handler(Looper.getMainLooper());
    private boolean visible = false;
    private BroadcastReceiver packages;
    String lastInsets = "";
    WidgetLayer widgets;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Log.i(TAG, "onCreate, saved state " + (state != null));
        current = this;
        edgeToEdge();

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
        s.setTextZoom(100); // the phone's font size setting must not break the layout
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.setHapticFeedbackEnabled(true);
        // a long press belongs to the page (the icon's menu), not to the system's text selection
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);

        bridge = new Bridge(this);
        web.addJavascriptInterface(bridge, "RezL");
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
        // the page, and above it a transparent layer for the widgets of other apps
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1));
        widgets = new WidgetLayer(this);
        root.addView(widgets, new android.widget.FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        web.loadUrl(AssetServer.BASE + "index.html");
        web.requestFocus();

        Page.All.add(this);
        MediaHub.attach(this);
        watchPackages();
    }

    // the page is drawn under the status and navigation bars; it is told their sizes
    private void edgeToEdge() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        View decor = w.getDecorView();
        if (Build.VERSION.SDK_INT >= 29) {
            w.setNavigationBarContrastEnforced(false);
            w.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        decor.setOnApplyWindowInsetsListener((v, ins) -> {
            sendInsets(ins);
            return v.onApplyWindowInsets(ins);
        });
    }

    @SuppressWarnings("deprecation")
    private void sendInsets(WindowInsets ins) {
        float d = getResources().getDisplayMetrics().density;
        int t;
        int b;
        int l;
        int r;
        int ime = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets bars = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets im = ins.getInsets(WindowInsets.Type.ime());
            t = bars.top;
            b = bars.bottom;
            l = bars.left;
            r = bars.right;
            ime = im.bottom;
        } else {
            t = ins.getSystemWindowInsetTop();
            b = ins.getSystemWindowInsetBottom();
            l = ins.getSystemWindowInsetLeft();
            r = ins.getSystemWindowInsetRight();
        }
        String j = "{\"t\":" + Math.round(t / d) + ",\"b\":" + Math.round(b / d) + ",\"l\":" + Math.round(l / d) + ",\"r\":" + Math.round(r / d) + ",\"ime\":" + Math.round(ime / d) + "}";
        if (j.equals(lastInsets)) return;
        lastInsets = j;
        emit("insets", j);
    }

    // apps installed or removed: the page's list is rebuilt
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

    @Override
    public android.content.Context context() {
        return this;
    }

    /** Sends an event to the page: window.__rezEmit(name, data). data is JSON. */
    @Override
    public void emit(final String name, final String json) {
        ui.post(() -> {
            if (web == null) return;
            web.evaluateJavascript("window.__rezEmit&&window.__rezEmit(" + JSONObject.quote(name) + "," + (json == null ? "null" : json) + ")", null);
        });
    }

    @Override
    public boolean isVisible() {
        return visible;
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
        Log.i(TAG, "onNewIntent " + intent);
        testWidget(intent);
        // the Home button while Резонанс is already in front: back to the first page
        if (intent != null && intent.hasCategory(Intent.CATEGORY_HOME)) emit("key", "\"home\"");
    }

    // for the emulator check only (builds with "dev" in the version): add the first widget the system has
    private void testWidget(Intent intent) {
        try {
            if (intent == null || !intent.hasExtra("test_widget") || widgets == null) return;
            String vn = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            if (vn == null || !vn.contains("dev")) return;
            org.json.JSONArray all = new org.json.JSONArray(widgets.list());
            String want = intent.getStringExtra("test_widget");
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.getJSONObject(i);
                if ("first".equals(want) || o.getString("k").contains(want)) {
                    Log.i(TAG, "test widget " + o.getString("k"));
                    widgets.add(o.getString("k"));
                    return;
                }
            }
            Log.w(TAG, "test widget: nothing to add, providers " + all.length());
        } catch (Exception e) {
            Log.w(TAG, "test widget: " + e);
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (widgets != null) widgets.start();
    }

    @Override
    protected void onStop() {
        if (widgets != null) widgets.stop();
        super.onStop();
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (widgets != null && (req == WidgetLayer.REQ_BIND || req == WidgetLayer.REQ_CONFIG)) widgets.onResult(req, result, data);
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        visible = true;
        if (web != null) {
            web.resumeTimers();
            web.onResume();
        }
        emit("visible", "true");
        MediaHub.refresh(this);
        Viz.resume(this);
        if (web != null) web.requestApplyInsets();
    }

    @Override
    protected void onPause() {
        visible = false;
        emit("visible", "false");
        Viz.stopFor(this);
        // an app is in front: the home screen sleeps (no drawing, no timers)
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
    protected void onDestroy() {
        try {
            if (packages != null) unregisterReceiver(packages);
        } catch (Exception ignored) {
        }
        Viz.stopFor(this);
        Page.All.remove(this);
        if (current == this) current = null;
        if (web != null) {
            web.removeJavascriptInterface("RezL");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // a home screen never closes: the page decides what Back does
        emit("key", "\"back\"");
    }
}
