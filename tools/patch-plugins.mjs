// Runs after `npm install`: adds a "like" heart to the playback notification of
// @capgo/capacitor-media-session (the plugin only knows the standard buttons).
// On Android 13+ the heart is a custom action of the media session (the system
// player shows it next to the track buttons); on older Android it is an extra
// notification button. Safe to run more than once.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, 'node_modules/@capgo/capacitor-media-session/android/src/main');
const MARK = '// REZONANS-LIKE';

if (!existsSync(base)) {
  console.log('patch-plugins: media session plugin not installed, skipping');
  process.exit(0);
}

function patch(rel, edits) {
  const file = join(base, rel);
  let s = readFileSync(file, 'utf8');
  if (s.includes(MARK)) return console.log('patch-plugins: already patched', rel);
  for (const [from, to] of edits) {
    if (!s.includes(from)) throw new Error(`patch-plugins: anchor not found in ${rel}:\n${from}`);
    s = s.replace(from, to);
  }
  writeFileSync(file, s);
  console.log('patch-plugins: patched', rel);
}

const J = 'java/com/capgo/mediasession/';

patch(J + 'MediaSessionService.java', [
  [
    'private int playbackState = PlaybackStateCompat.STATE_NONE;',
    `${MARK}
    public static final String ACTION_LIKE = "app.rezonans.player.LIKE";
    private boolean likeEnabled = false;
    private boolean liked = false;

    public void setLike(boolean enabled, boolean isLiked) {
        if (likeEnabled != enabled || liked != isLiked) {
            likeEnabled = enabled;
            liked = isLiked;
            possibleActionsUpdate = true;
        }
    }

    private int likeIcon() {
        return liked ? R.drawable.ic_rez_heart_24 : R.drawable.ic_rez_heart_outline_24;
    }

    private String likeLabel() {
        return liked ? "Убрать из «Мне нравится»" : "Нравится";
    }

    private PendingIntent likeIntent() {
        Intent i = new Intent(this, MediaSessionService.class).setAction(ACTION_LIKE);
        return PendingIntent.getService(this, 41, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private int playbackState = PlaybackStateCompat.STATE_NONE;`,
  ],
  [
    `        if (mediaSession != null) {
            MediaButtonReceiver.handleIntent(mediaSession, intent);
        }`,
    `        if (intent != null && ACTION_LIKE.equals(intent.getAction())) {
            if (plugin != null) plugin.actionCallback("like");
            return START_NOT_STICKY;
        }
        if (mediaSession != null) {
            MediaButtonReceiver.handleIntent(mediaSession, intent);
        }`,
  ],
  [
    `            if (playbackStateBuilder != null) {
                playbackStateBuilder.setActions(activePlaybackStateActions);
            }`,
    `            if (likeEnabled && notificationBuilder != null) {
                notificationBuilder.addAction(new NotificationCompat.Action(likeIcon(), likeLabel(), likeIntent()));
            }
            if (playbackStateBuilder != null) {
                playbackStateBuilder.setActions(activePlaybackStateActions);
            }`,
  ],
  [
    `            playbackStateBuilder.setState(playbackState, position, playbackSpeed);
            mediaSession.setPlaybackState(playbackStateBuilder.build());`,
    `            playbackStateBuilder.setState(playbackState, position, playbackSpeed);
            PlaybackStateCompat.Builder withLike = new PlaybackStateCompat.Builder(playbackStateBuilder.build());
            if (likeEnabled) {
                withLike.addCustomAction(new PlaybackStateCompat.CustomAction.Builder("like", likeLabel(), likeIcon()).build());
            }
            mediaSession.setPlaybackState(withLike.build());`,
  ],
]);

patch(J + 'MediaSessionCallback.java', [
  [
    `    @Override
    public void onStop() {`,
    `    ${MARK}
    @Override
    public void onCustomAction(String action, android.os.Bundle extras) {
        if ("like".equals(action)) plugin.actionCallback("like");
    }

    @Override
    public void onStop() {`,
  ],
]);

patch(J + 'MediaSessionPlugin.java', [
  [
    'private final Map<String, PluginCall> actionHandlers = new HashMap<>();',
    `private final Map<String, PluginCall> actionHandlers = new HashMap<>();

    ${MARK}
    private boolean likeEnabled = false;
    private boolean liked = false;

    @PluginMethod
    public void setLikeState(PluginCall call) {
        likeEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        liked = Boolean.TRUE.equals(call.getBoolean("liked", false));
        if (service != null) {
            service.setLike(likeEnabled, liked);
            service.update();
        }
        call.resolve();
    }`,
  ],
  [
    `            service.connectAndInitialize(MediaSessionPlugin.this, launchIntent);`,
    `            service.connectAndInitialize(MediaSessionPlugin.this, launchIntent);
            service.setLike(likeEnabled, liked);`,
  ],
]);

const icons = {
  'ic_rez_heart_24.xml':
    'M12,21.35l-1.45,-1.32C5.4,15.36 2,12.28 2,8.5 2,5.42 4.42,3 7.5,3c1.74,0 3.41,0.81 4.5,2.09C13.09,3.81 14.76,3 16.5,3 19.58,3 22,5.42 22,8.5c0,3.78 -3.4,6.86 -8.55,11.54L12,21.35z',
  'ic_rez_heart_outline_24.xml':
    'M16.5,3c-1.74,0 -3.41,0.81 -4.5,2.09C10.91,3.81 9.24,3 7.5,3 4.42,3 2,5.42 2,8.5c0,3.78 3.4,6.86 8.55,11.54L12,21.35l1.45,-1.32C18.6,15.36 22,12.28 22,8.5 22,5.42 19.58,3 16.5,3zM12.1,18.55l-0.1,0.1 -0.1,-0.1C7.14,14.24 4,11.39 4,8.5 4,6.5 5.5,5 7.5,5c1.54,0 3.04,0.99 3.57,2.36h1.87C13.46,5.99 14.96,5 16.5,5c2,0 3.5,1.5 3.5,3.5 0,2.89 -3.14,5.74 -7.9,10.05z',
};
const dir = join(base, 'res/drawable');
mkdirSync(dir, { recursive: true });
for (const [name, path] of Object.entries(icons)) {
  writeFileSync(
    join(dir, name),
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:height="24dp"
    android:tint="#000000"
    android:viewportHeight="24"
    android:viewportWidth="24"
    android:width="24dp">
    <path
        android:fillColor="@android:color/white"
        android:pathData="${path}" />
</vector>
`
  );
}
console.log('patch-plugins: heart icons in place');
