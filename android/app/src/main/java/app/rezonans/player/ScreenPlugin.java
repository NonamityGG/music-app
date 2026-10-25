package app.rezonans.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The screen around the page: hands over from the splash, switches full screen,
 * and — since the system status bar is hidden in full screen — tells the page the
 * battery level and the network, so it can show its own status line.
 */
@CapacitorPlugin(name = "Screen")
public class ScreenPlugin extends Plugin {

    private BroadcastReceiver batteryReceiver;
    private ConnectivityManager.NetworkCallback netCallback;
    private int battery = -1;
    private boolean charging = false;
    private String net = "none";
    private int netLevel = -1;

    private MainActivity main() {
        return getActivity() instanceof MainActivity ? (MainActivity) getActivity() : null;
    }

    @PluginMethod
    public void shown(PluginCall call) {
        MainActivity a = main();
        if (a != null) a.markWebShown();
        call.resolve();
    }

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        getBridge()
            .executeOnMainThread(() -> {
                MainActivity a = main();
                if (a != null) a.setFullscreen(on);
                call.resolve();
            });
    }

    @PluginMethod
    public void getFullscreen(PluginCall call) {
        MainActivity a = main();
        JSObject r = new JSObject();
        r.put("enabled", a == null || a.isFullscreen());
        call.resolve(r);
    }

    /** Starts watching battery and network; resolves with the current state, then sends "status" events. */
    @PluginMethod
    public void watchStatus(PluginCall call) {
        getBridge()
            .executeOnMainThread(() -> {
                startWatching();
                call.resolve(status());
            });
    }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("battery", battery);
        o.put("charging", charging);
        o.put("net", net);
        o.put("level", netLevel);
        return o;
    }

    private void send() {
        notifyListeners("status", status());
    }

    private void readBattery(Intent i) {
        if (i == null) return;
        int level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
        int st = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        int plugged = i.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
        battery = level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : -1;
        charging = plugged != 0 || st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL;
    }

    private void readNetwork(NetworkCapabilities caps) {
        if (caps == null) {
            net = "none";
            netLevel = -1;
            return;
        }
        int strength = Integer.MIN_VALUE;
        if (Build.VERSION.SDK_INT >= 29) strength = caps.getSignalStrength();
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            net = "wifi";
            // Wi-Fi RSSI in dBm -> 0..3 arcs
            netLevel = strength == Integer.MIN_VALUE ? 3 : strength > -60 ? 3 : strength > -70 ? 2 : strength > -80 ? 1 : 0;
        } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
            net = "cell";
            // dBm -> 0..4 bars, unknown stays -1 (drawn as full)
            netLevel = strength == Integer.MIN_VALUE
                ? -1
                : strength > -90 ? 4 : strength > -100 ? 3 : strength > -110 ? 2 : strength > -120 ? 1 : 0;
        } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
            net = "eth";
            netLevel = -1;
        } else {
            net = "other";
            netLevel = -1;
        }
    }

    private void startWatching() {
        Context ctx = getContext();
        if (batteryReceiver == null) {
            batteryReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent intent) {
                    int b = battery;
                    boolean ch = charging;
                    readBattery(intent);
                    if (b != battery || ch != charging) send();
                }
            };
            Intent sticky = ContextCompat.registerReceiver(
                ctx,
                batteryReceiver,
                new IntentFilter(Intent.ACTION_BATTERY_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
            readBattery(sticky);
        }
        if (netCallback == null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    Network active = cm.getActiveNetwork();
                    readNetwork(active != null ? cm.getNetworkCapabilities(active) : null);
                    netCallback = new ConnectivityManager.NetworkCallback() {
                        @Override
                        public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                            String n = net;
                            int l = netLevel;
                            readNetwork(caps);
                            if (!n.equals(net) || l != netLevel) send();
                        }

                        @Override
                        public void onLost(Network network) {
                            readNetwork(null);
                            send();
                        }
                    };
                    cm.registerDefaultNetworkCallback(netCallback);
                }
            } catch (Exception e) {
                netCallback = null; // no network permission: the line just shows no network icon
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        Context ctx = getContext();
        try {
            if (batteryReceiver != null) ctx.unregisterReceiver(batteryReceiver);
        } catch (Exception ignored) {}
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && netCallback != null) cm.unregisterNetworkCallback(netCallback);
        } catch (Exception ignored) {}
        batteryReceiver = null;
        netCallback = null;
        super.handleOnDestroy();
    }
}
