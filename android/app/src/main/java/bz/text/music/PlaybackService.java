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
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
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
    /** Where the song is (ms, -1 unknown), how long it is, and the two buttons next to the transport: shuffle and like. The system moves the seek bar by itself between updates. */
    private static long posMs = -1, durMs = 0, syncAt = 0;
    private static boolean shuffleOn, liked, skipOn;
    /** The left button is one "how it plays" control: 0 in order, 1 shuffle, 2 this song once more, 3 pause after this song. */
    private static int mode;
    private static PlaybackService live;
    private MediaSession session;
    private final Handler main = new Handler(Looper.getMainLooper());
    /** A pause is often just a song change: stay a foreground service (and keep the process) for a while before letting go. */
    private final Runnable detachLater = () -> { try { if (!playing && Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_DETACH); } catch (Throwable ignored) { } };
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    /** While playing: keep the CPU (and Wi-Fi) awake so the web player can hand over to the next song with the screen off. */
    private void holdLocks(boolean on) {
        try {
            if (on) {
                if (wake == null) { PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE); if (pm != null) { wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mymusic:playback"); wake.setReferenceCounted(false); } }
                if (wake != null && !wake.isHeld()) wake.acquire(4 * 60 * 60 * 1000L);
                if (wifi == null) { WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE); if (wm != null) { wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "mymusic:wifi"); wifi.setReferenceCounted(false); } }
                if (wifi != null && !wifi.isHeld()) wifi.acquire();
            } else {
                if (wake != null && wake.isHeld()) wake.release();
                if (wifi != null && wifi.isHeld()) wifi.release();
            }
        } catch (Exception ignored) { }
    }

    static void update(Context c, boolean p, String t, String a, String cv) {
        try { updateUnsafe(c, p, t, a, cv); } catch (Throwable ignored) { } // never let a notification problem reach the web page (or kill the app)
    }

    private static void updateUnsafe(Context c, boolean p, String t, String a, String cv) {
        boolean coverChanged = !cv.equals(cover);
        playing = p; title = t; artist = a; cover = cv;
        if (coverChanged) art = null;
        if (live == null) {
            if (!p && t.isEmpty()) return; // nothing to show yet
            Intent i = new Intent(c, PlaybackService.class);
            try { if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i); } catch (Exception ignored) { }
        } else {
            final PlaybackService s = live;
            s.main.post(() -> { if (live == s) s.refresh(); });
        }
        if (coverChanged && !cv.isEmpty()) fetchArt(cv);
    }

    /** Position / length / shuffle / like from the web player (called on song change, play/pause, seek, like and shuffle — not every second). */
    static void sync(Context c, long pos, long dur, boolean shuffle, boolean like) {
        try {
            posMs = pos; durMs = dur; syncAt = SystemClock.elapsedRealtime(); shuffleOn = shuffle; liked = like;
            final PlaybackService s = live;
            if (s != null) s.main.post(() -> { if (live == s) s.refresh(); });
        } catch (Throwable ignored) { }
    }

    /** Which of the four play modes is on, and whether the song on screen is on skip. */
    static void mode(int m, boolean skip) {
        mode = m; skipOn = skip;
    }

    private static int modeIcon() { return mode == 3 ? R.drawable.ic_mode_stop : mode == 2 ? R.drawable.ic_mode_again : (mode == 1 || (mode == 0 && shuffleOn)) ? R.drawable.ic_shuffle_on : R.drawable.ic_shuffle_off; }
    private static String modeLabel() { return mode == 3 ? "Pause after this song" : mode == 2 ? "Repeat this song once" : mode == 1 ? "Shuffle" : "Play in order"; }

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
            @Override public void onSeekTo(long pos) { MainActivity.command("seek:" + (pos / 1000.0)); }
            @Override public void onCustomAction(String action, android.os.Bundle extras) { if ("mode".equals(action) || "like".equals(action) || "skip".equals(action)) MainActivity.command(action); }
        });
        session.setActive(true);
        try { startForeground(ID, build()); } catch (Throwable e) { stopSelf(); }
    }

    @Override public int onStartCommand(Intent i, int f, int id) {
        if (i != null && i.getAction() != null) {
            switch (i.getAction()) {
                case "toggle": MainActivity.command("toggle"); break;
                case "next": MainActivity.command("next"); break;
                case "prev": MainActivity.command("prev"); break;
                case "mode": MainActivity.command("mode"); break;
                case "skip": MainActivity.command("skip"); break;
                case "like": MainActivity.command("like"); break;
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
        if (art != null) { md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art); md.putBitmap(MediaMetadata.METADATA_KEY_ART, art); }
        if (durMs > 0) md.putLong(MediaMetadata.METADATA_KEY_DURATION, durMs); // gives the lock screen its seek bar and the 0:11 / 5:15 times
        session.setMetadata(md.build());
        PlaybackState.Builder ps = new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, posMs >= 0 ? posMs : PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f, posMs >= 0 ? syncAt : SystemClock.elapsedRealtime())
            // exactly two custom buttons, as before: left of the transport (play mode) and right of it (like). A third one made some lock screens rearrange the row.
            .addCustomAction(new PlaybackState.CustomAction.Builder("mode", modeLabel(), modeIcon()).build())
            .addCustomAction(new PlaybackState.CustomAction.Builder("like", "Like", liked ? R.drawable.ic_heart_on : R.drawable.ic_heart_off).build());
        session.setPlaybackState(ps.build());
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder n = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        n.setSmallIcon(R.drawable.ic_stat_music).setContentTitle(title.isEmpty() ? "My Music" : title).setContentText(artist).setContentIntent(open)
            .setOngoing(playing).setShowWhen(false).setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(modeIcon(), modeLabel(), act("mode", 4)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", act("prev", 1)).build())
            .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pause" : "Play", act("toggle", 2)).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", act("next", 3)).build())
            .addAction(new Notification.Action.Builder(liked ? R.drawable.ic_heart_on : R.drawable.ic_heart_off, "Like", act("like", 5)).build())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(1, 2, 3));
        if (art != null) n.setLargeIcon(art);
        return n.build();
    }

    void refresh() {
        try {
            holdLocks(playing);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(ID, build());
            main.removeCallbacks(detachLater);
            if (playing) startForeground(ID, build());
            else main.postDelayed(detachLater, 90_000); // paused: swipeable, but only after a grace period
        } catch (Throwable ignored) { }
    }

    @Override public void onTaskRemoved(Intent rootIntent) { MainActivity.markCleanExit(this); stopForeground(true); stopSelf(); }

    @Override public void onDestroy() {
        holdLocks(false);
        main.removeCallbacks(detachLater);
        if (live == this) live = null;
        if (session != null) { session.setActive(false); session.release(); }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent i) { return null; }
}
