package app.rezonans.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the box starts: Резонанс OS comes up (if it is to replace the box's home). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        Prefs.unpause(c);
        if (!Prefs.guard(c)) return;
        Intent i = new Intent(c, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(i);
        } catch (Exception ignored) {
        }
    }
}
