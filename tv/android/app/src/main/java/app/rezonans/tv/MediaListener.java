package app.rezonans.tv;

import android.app.Notification;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Exists so Android lets Резонанс OS see media sessions ("now playing" on the
 * home screen). Of the notifications only one thing is looked at: the cover in
 * the playback notification of the app that is playing, for apps that don't
 * put it in their media session. Nothing is kept or sent anywhere.
 */
public class MediaListener extends NotificationListenerService {
    private static volatile MediaListener live;

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        live = this;
        MediaHub.attach(this);
    }

    @Override
    public void onListenerDisconnected() {
        if (live == this) live = null;
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn != null && isPlayback(sbn.getNotification())) MediaHub.notificationChanged(sbn.getPackageName());
    }

    private static boolean isPlayback(Notification n) {
        if (n == null) return false;
        return (n.extras != null && n.extras.containsKey(Notification.EXTRA_MEDIA_SESSION)) || Notification.CATEGORY_TRANSPORT.equals(n.category);
    }

    /** The picture of the playback notification of this app, if there is one. */
    static Bitmap coverOf(String pkg) {
        MediaListener l = live;
        if (l == null || pkg == null) return null;
        try {
            StatusBarNotification[] all = l.getActiveNotifications();
            if (all == null) return null;
            for (StatusBarNotification sbn : all) {
                if (!pkg.equals(sbn.getPackageName()) || !isPlayback(sbn.getNotification())) continue;
                Bitmap b = picture(l, sbn.getNotification());
                if (b != null) return b;
            }
        } catch (Exception ignored) {
            // not connected yet
        }
        return null;
    }

    private static Bitmap picture(NotificationListenerService c, Notification n) {
        if (Build.VERSION.SDK_INT >= 23) {
            Icon ic = n.getLargeIcon();
            if (ic != null) {
                Bitmap b = bitmap(ic.loadDrawable(c));
                if (b != null) return b;
            }
        }
        if (n.extras == null) return null;
        for (String k : new String[] {Notification.EXTRA_LARGE_ICON_BIG, Notification.EXTRA_LARGE_ICON, Notification.EXTRA_PICTURE}) {
            Parcelable p = n.extras.getParcelable(k);
            if (p instanceof Bitmap) return (Bitmap) p;
            if (Build.VERSION.SDK_INT >= 23 && p instanceof Icon) {
                Bitmap b = bitmap(((Icon) p).loadDrawable(c));
                if (b != null) return b;
            }
        }
        return null;
    }

    private static Bitmap bitmap(Drawable d) {
        if (d == null) return null;
        if (d instanceof BitmapDrawable) return ((BitmapDrawable) d).getBitmap();
        int w = d.getIntrinsicWidth();
        int h = d.getIntrinsicHeight();
        if (w <= 1 || h <= 1) return null;
        Bitmap b = Bitmap.createBitmap(Math.min(w, 512), Math.min(h, 512), Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        d.setBounds(0, 0, cv.getWidth(), cv.getHeight());
        d.draw(cv);
        return b;
    }
}
