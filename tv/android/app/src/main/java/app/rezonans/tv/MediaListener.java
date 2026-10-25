package app.rezonans.tv;

import android.service.notification.NotificationListenerService;

/**
 * Exists so Android lets Резонанс OS see media sessions ("now playing" on the
 * home screen). Notifications themselves are not read.
 */
public class MediaListener extends NotificationListenerService {
    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        MediaHub.attach(this);
    }
}
