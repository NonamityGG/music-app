package app.rezonans.launcher;

import android.app.Activity;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.SparseArray;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Widgets of other apps. They are real Android views (AppWidgetHostView), so
 * they live above the page: the page keeps an empty place for each one in the
 * desktop grid and tells where that place is (in CSS pixels, every frame it
 * moves); this layer puts the widget's view exactly there. While a menu, the
 * drawer or a drag is above the desktop the page says "hidden".
 *
 * Touches: a tap or a scroll inside the widget belongs to the widget; a
 * sideways swipe is handed to the page (pages turn); a long press is sent to
 * the page (the widget's menu).
 */
public class WidgetLayer extends FrameLayout {

    static final int HOST_ID = 0x52454;
    static final int REQ_BIND = 7101;
    static final int REQ_CONFIG = 7102;

    private final MainActivity act;
    private final AppWidgetHost host;
    private final AppWidgetManager mgr;
    private final SparseArray<Cell> cells = new SparseArray<>();
    private int pending = -1;
    private boolean listening = false;

    public WidgetLayer(MainActivity act) {
        super(act);
        this.act = act;
        host = new AppWidgetHost(act, HOST_ID);
        mgr = AppWidgetManager.getInstance(act);
        setClipChildren(false);
    }

    // ---------- listening ----------

    void start() {
        if (listening) return;
        try {
            host.startListening();
            listening = true;
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "widget host: " + e);
        }
    }

    void stop() {
        if (!listening) return;
        try {
            host.stopListening();
        } catch (Exception ignored) {
        }
        listening = false;
    }

    // ---------- what can be added ----------

    String list() {
        JSONArray out = new JSONArray();
        try {
            PackageManager pm = act.getPackageManager();
            float d = act.getResources().getDisplayMetrics().density;
            List<AppWidgetProviderInfo> all = mgr.getInstalledProviders();
            for (AppWidgetProviderInfo p : all) {
                if (p.provider == null) continue;
                JSONObject o = new JSONObject();
                o.put("k", p.provider.flattenToString());
                o.put("pkg", p.provider.getPackageName());
                String label;
                try {
                    label = p.loadLabel(pm);
                } catch (Exception e) {
                    label = p.provider.getShortClassName();
                }
                o.put("label", label);
                o.put("w", Math.round(p.minWidth / d));
                o.put("h", Math.round(p.minHeight / d));
                o.put("cfg", p.configure != null);
                out.put(o);
            }
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "widget list: " + e);
        }
        return out.toString();
    }

    private AppWidgetProviderInfo find(ComponentName cn) {
        for (AppWidgetProviderInfo p : mgr.getInstalledProviders()) if (cn.equals(p.provider)) return p;
        return null;
    }

    // ---------- adding: allocate, bind (the system asks once), configure, tell the page ----------

    void add(String key) {
        ComponentName cn = ComponentName.unflattenFromString(key);
        if (cn == null || find(cn) == null) {
            act.emit("widgetFail", "\"нет такого виджета\"");
            return;
        }
        start();
        int id = host.allocateAppWidgetId();
        boolean ok = false;
        try {
            ok = mgr.bindAppWidgetIdIfAllowed(id, cn);
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "bind: " + e);
        }
        if (ok) {
            afterBind(id);
            return;
        }
        // the system's own question: "Allow Резонанс to create widgets?"
        pending = id;
        Intent i = new Intent(AppWidgetManager.ACTION_APPWIDGET_BIND);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_PROVIDER, cn);
        try {
            act.startActivityForResult(i, REQ_BIND);
        } catch (Exception e) {
            host.deleteAppWidgetId(id);
            pending = -1;
            act.emit("widgetFail", "\"система не дала привязать виджет\"");
        }
    }

    private void afterBind(int id) {
        AppWidgetProviderInfo info = mgr.getAppWidgetInfo(id);
        if (info != null && info.configure != null) {
            pending = id;
            try {
                host.startAppWidgetConfigureActivityForResult(act, id, 0, REQ_CONFIG, null);
                return;
            } catch (Exception e) {
                Log.w(MainActivity.TAG, "configure: " + e);
            }
        }
        done(id);
    }

    void onResult(int req, int result, Intent data) {
        int id = pending;
        if (data != null) id = data.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        pending = -1;
        if (id < 0) return;
        if (result != Activity.RESULT_OK) {
            host.deleteAppWidgetId(id);
            return;
        }
        if (req == REQ_BIND) afterBind(id);
        else done(id);
    }

    private void done(int id) {
        try {
            AppWidgetProviderInfo info = mgr.getAppWidgetInfo(id);
            if (info == null) {
                host.deleteAppWidgetId(id);
                return;
            }
            float d = act.getResources().getDisplayMetrics().density;
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("w", Math.round(info.minWidth / d));
            o.put("h", Math.round(info.minHeight / d));
            o.put("label", info.loadLabel(act.getPackageManager()));
            Log.i(MainActivity.TAG, "widget " + id + " bound, telling the page");
            act.emit("widgetAdded", o.toString());
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "widget done: " + e);
        }
    }

    void remove(int id) {
        act.ui.post(() -> {
            Cell c = cells.get(id);
            if (c != null) {
                removeView(c);
                cells.remove(id);
            }
            try {
                host.deleteAppWidgetId(id);
            } catch (Exception ignored) {
            }
        });
    }

    // ---------- where the page says they are ----------

    /** json: [{id, x, y, w, h}] in CSS pixels; widgets that are not in the list are hidden. */
    void frames(String json) {
        act.ui.post(() -> apply(json));
    }

    private void apply(String json) {
        try {
            start();
            float d = act.getResources().getDisplayMetrics().density;
            JSONArray arr = new JSONArray(json);
            java.util.HashSet<Integer> shown = new java.util.HashSet<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                int id = o.getInt("id");
                Cell c = cells.get(id);
                if (c == null) {
                    c = make(id);
                    if (c == null) continue;
                }
                int w = Math.max(1, Math.round((float) o.getDouble("w") * d));
                int h = Math.max(1, Math.round((float) o.getDouble("h") * d));
                if (!c.logged) {
                    c.logged = true;
                    Log.i(MainActivity.TAG, "widget " + id + " shown at " + o.getDouble("x") + "," + o.getDouble("y") + " " + o.getDouble("w") + "x" + o.getDouble("h"));
                }
                c.place(Math.round((float) o.getDouble("x") * d), Math.round((float) o.getDouble("y") * d), w, h, d);
                shown.add(id);
            }
            for (int i = 0; i < cells.size(); i++) {
                Cell c = cells.valueAt(i);
                if (!shown.contains(cells.keyAt(i))) c.setVisibility(View.GONE);
            }
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "widget frames: " + e);
        }
    }

    private Cell make(int id) {
        AppWidgetProviderInfo info = mgr.getAppWidgetInfo(id);
        if (info == null) {
            // the app was removed: the page forgets the widget
            act.emit("widgetGone", String.valueOf(id));
            return null;
        }
        AppWidgetHostView v;
        try {
            v = host.createView(act, id, info);
        } catch (Exception e) {
            Log.w(MainActivity.TAG, "createView: " + e);
            return null;
        }
        Cell c = new Cell(act, id, v);
        cells.put(id, c);
        addView(c, new FrameLayout.LayoutParams(1, 1));
        return c;
    }

    // ---------- one widget ----------

    final class Cell extends FrameLayout {
        final int id;
        final AppWidgetHostView view;
        private MotionEvent down;
        private boolean longSent = false;
        private boolean toPage = false;
        boolean logged = false;
        private final int slop;
        private final Runnable longPress = new Runnable() {
            @Override
            public void run() {
                longSent = true;
                performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
                try {
                    JSONObject o = new JSONObject();
                    o.put("id", id);
                    act.emit("widgetLong", o.toString());
                } catch (Exception ignored) {
                }
            }
        };

        Cell(Context ctx, int id, AppWidgetHostView view) {
            super(ctx);
            this.id = id;
            this.view = view;
            slop = ViewConfiguration.get(ctx).getScaledTouchSlop();
            addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            setClipToOutline(true);
            final float dd = ctx.getResources().getDisplayMetrics().density;
            setOutlineProvider(new android.view.ViewOutlineProvider() {
                @Override
                public void getOutline(View v, android.graphics.Outline o) {
                    o.setRoundRect(0, 0, v.getWidth(), v.getHeight(), 26 * dd);
                }
            });
        }

        void place(int x, int y, int w, int h, float d) {
            FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) getLayoutParams();
            if (lp.width != w || lp.height != h) {
                lp.width = w;
                lp.height = h;
                setLayoutParams(lp);
                float dpw = w / d;
                float dph = h / d;
                try {
                    view.updateAppWidgetSize(new Bundle(), Math.round(dpw), Math.round(dph), Math.round(dpw), Math.round(dph));
                } catch (Exception ignored) {
                }
            }
            setTranslationX(x);
            setTranslationY(y);
            setVisibility(View.VISIBLE);
        }

        // The widget may or may not use the touch. Either way this cell sees every
        // event (through the intercept when a child took it, through onTouchEvent
        // when none did), so the same watcher runs in both: a long press and a
        // sideways swipe belong to the page.
        private boolean watch(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    if (down != null) down.recycle();
                    down = MotionEvent.obtain(e);
                    longSent = false;
                    toPage = false;
                    removeCallbacks(longPress);
                    postDelayed(longPress, ViewConfiguration.getLongPressTimeout());
                    return false;
                case MotionEvent.ACTION_MOVE:
                    if (down == null || toPage) return false;
                    float dx = e.getX() - down.getX();
                    float dy = e.getY() - down.getY();
                    if (Math.hypot(dx, dy) > slop) removeCallbacks(longPress);
                    if (longSent) return false;
                    if (Math.abs(dx) > slop * 2 && Math.abs(dx) > Math.abs(dy) * 1.2f) {
                        toPage = true;
                        Log.i(MainActivity.TAG, "widget " + id + ": sideways swipe goes to the page");
                        handToPage(e);
                        return true;
                    }
                    return false;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    removeCallbacks(longPress);
                    return false;
                default:
                    return false;
            }
        }

        @Override
        public boolean onInterceptTouchEvent(MotionEvent e) {
            boolean grab = watch(e);
            return grab || longSent;
        }

        @Override
        public boolean onTouchEvent(MotionEvent e) {
            int a = e.getActionMasked();
            if (toPage) {
                forward(e);
                if (a == MotionEvent.ACTION_UP || a == MotionEvent.ACTION_CANCEL) toPage = false;
                return true;
            }
            // nobody inside took the touch: this cell is the target and the intercept is not asked again
            if (a != MotionEvent.ACTION_DOWN && watch(e)) return true;
            return true;
        }

        private void forward(MotionEvent e) {
            WebView w = act.web;
            if (w == null) return;
            MotionEvent m = MotionEvent.obtain(e);
            m.offsetLocation(getX(), getY());
            w.dispatchTouchEvent(m);
            m.recycle();
        }

        private void handToPage(MotionEvent now) {
            WebView w = act.web;
            if (w == null) return;
            // the widget lets go (cancel), the page gets a touch that begins right here
            MotionEvent cancel = MotionEvent.obtain(now.getDownTime(), now.getEventTime(), MotionEvent.ACTION_CANCEL, now.getX(), now.getY(), 0);
            view.dispatchTouchEvent(cancel);
            cancel.recycle();
            MotionEvent d0 = MotionEvent.obtain(now.getDownTime(), now.getEventTime(), MotionEvent.ACTION_DOWN, now.getX() + getX(), now.getY() + getY(), 0);
            w.dispatchTouchEvent(d0);
            d0.recycle();
        }
    }
}
