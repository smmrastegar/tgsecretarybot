package bz.text.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Foreground service + MediaSession: keeps the process (and so the WebView's audio)
 * alive in the background and shows playback controls on the lock screen and in the
 * notification shade. The state comes from the web player via AndroidMusic.state().
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int ID = 7;
    private static boolean playing;
    private static String title = "", artist = "", cover = "";
    private static Bitmap art;
    private static PlaybackService live;
    private MediaSession session;

    static void update(Context c, boolean p, String t, String a, String cv) {
        boolean coverChanged = !cv.equals(cover);
        playing = p; title = t; artist = a; cover = cv;
        if (coverChanged) art = null;
        if (live == null) {
            if (!p && t.isEmpty()) return; // nothing to show yet
            Intent i = new Intent(c, PlaybackService.class);
            try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i); } catch (Exception ignored) { }
        } else {
            live.refresh();
        }
        if (coverChanged && !cv.isEmpty()) fetchArt(cv);
    }

    private static void fetchArt(final String url) {
        new Thread(() -> {
            try {
                HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
                h.setConnectTimeout(8000); h.setReadTimeout(8000);
                try (InputStream in = h.getInputStream()) {
                    Bitmap b = BitmapFactory.decodeStream(in);
                    if (b != null && url.equals(cover)) { art = b; if (live != null) live.refresh(); }
                }
            } catch (Exception ignored) { }
        }).start();
    }

    @Override public void onCreate() {
        super.onCreate();
        live = this;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW));
        session = new MediaSession(this, "MyMusic");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { MainActivity.command("play"); }
            @Override public void onPause() { MainActivity.command("pause"); }
            @Override public void onSkipToNext() { MainActivity.command("next"); }
            @Override public void onSkipToPrevious() { MainActivity.command("prev"); }
        });
        session.setActive(true);
        startForeground(ID, build());
    }

    @Override public int onStartCommand(Intent i, int f, int id) {
        if (i != null && i.getAction() != null) {
            switch (i.getAction()) {
                case "toggle": MainActivity.command("toggle"); break;
                case "next": MainActivity.command("next"); break;
                case "prev": MainActivity.command("prev"); break;
                case "close": stopForeground(true); stopSelf(); break;
                default: break;
            }
        }
        refresh();
        return START_NOT_STICKY;
    }

    private PendingIntent act(String action, int code) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification build() {
        MediaMetadata.Builder md = new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title.isEmpty() ? "My Music" : title).putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
        if (art != null) md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(md.build());
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f).build());
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder n = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        n.setSmallIcon(R.drawable.ic_stat_music).setContentTitle(title.isEmpty() ? "My Music" : title).setContentText(artist).setContentIntent(open)
            .setOngoing(playing).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", act("prev", 1)).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pause" : "Play", act("toggle", 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", act("next", 3)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (art != null) n.setLargeIcon(art);
        return n.build();
    }

    void refresh() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(ID, build());
        if (!playing && Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_DETACH); // paused: swipeable
        else if (playing) { try { startForeground(ID, build()); } catch (Exception ignored) { } }
    }

    @Override public void onTaskRemoved(Intent rootIntent) { stopForeground(true); stopSelf(); }

    @Override public void onDestroy() {
        if (live == this) live = null;
        if (session != null) { session.setActive(false); session.release(); }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
