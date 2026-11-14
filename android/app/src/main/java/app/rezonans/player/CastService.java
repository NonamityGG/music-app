package app.rezonans.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * Keeps the showing on the TV alive while the person uses other apps: Android
 * lets a screen capture run only from a foreground service of the
 * "mediaProjection" type, with a notification (and a «Остановить» on it).
 */
public class CastService extends Service {
    static final String STOP = "app.rezonans.player.CAST_STOP";
    private static final String CHANNEL = "cast";
    private static final int ID = 4823;

    interface Ready {
        void ready(CastService s);
    }

    private static Ready pending;
    private static CastService running;

    static void start(Context c, Ready r) {
        pending = r;
        Intent i = new Intent(c, CastService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    static void stopNow(Context c) {
        c.stopService(new Intent(c, CastService.class));
    }

    static CastService current() {
        return running;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            CastPlugin.stopFromSystem("phone");
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            Notification n = notification();
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(ID, n);
        } catch (Exception e) {
            Log.w("RezCast", "служба показа: " + e);
            stopSelf();
            Ready r = pending;
            pending = null;
            if (r != null) r.ready(null);
            return START_NOT_STICKY;
        }
        running = this;
        Ready r = pending;
        pending = null;
        if (r != null) r.ready(this);
        return START_NOT_STICKY;
    }

    void title(String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(ID, build(text));
        } catch (Exception ignored) {
        }
    }

    private Notification notification() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Показ на телевизоре", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
        return build("Подключаюсь к телевизору…");
    }

    private Notification build(String text) {
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, CastService.class).setAction(STOP), fl);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(this, 2, open, fl);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Резонанс Connect")
            .setContentText(text)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Остановить", stop).build());
        if (tap != null) b.setContentIntent(tap);
        return b.build();
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        CastPlugin.rotated();
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
