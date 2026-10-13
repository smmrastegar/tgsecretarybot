package bz.text.music;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * My Music: a thin native shell around https://playlist.bz/listen.
 * The web player does everything; the shell adds what a browser tab cannot:
 * keeps playing with the screen off (foreground service), lock-screen /
 * notification / headset controls, opening player links from chats, and Back
 * that never kills the music.
 */
public class MainActivity extends Activity {
    static final String HOST = "playlist.bz";
    /** The address the app used before it moved to playlist.bz: its saved player link is picked up once from there. */
    static final String OLD_HOME = "https://bot.text.bz/listen?migrate=1";
    /** Every host that is "ours": the app stays inside for these, and player links on them open here. */
    static boolean ours(String h) { return "bot.text.bz".equals(h) || "chatbot.bz".equals(h) || "www.chatbot.bz".equals(h) || "playlist.bz".equals(h); }
    static final String HOME = "https://" + HOST + "/listen";
    static MainActivity instance;
    private WebView web;
    private SharedPreferences prefs;
    private String failedUrl;      // set while the "can't connect" page is showing
    private ConnectivityManager.NetworkCallback netCb;

    private static final String ERROR_PAGE =
        "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        + "<style>html,body{margin:0;height:100%;background:#0b0b0f;color:#ececf1;font:16px sans-serif}"
        + "main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;box-sizing:border-box}"
        + "h1{font-size:22px;margin:0}p{margin:0;color:#a1a1aa;line-height:1.6}"
        + "button{margin-top:8px;height:50px;padding:0 30px;border:0;border-radius:25px;background:#ececf1;color:#0b0b0f;font-size:16px;font-weight:700}</style></head>"
        + "<body><main><h1>Can't reach the server</h1><p>Check your connection.<br>It will try again by itself when you are back online.</p>"
        + "<button onclick='AndroidMusic.retry()'>Try again</button></main>"
        + "<script>setInterval(function(){if(navigator.onLine)AndroidMusic.retry()},10000)</script></body></html>";

    private void showError(String url) {
        if (failedUrl != null) return;
        failedUrl = url;
        web.loadDataWithBaseURL(null, ERROR_PAGE, "text/html", "utf-8", null);
    }

    /** Try the page that failed again (button, timer, or the network coming back). */
    private void retryNow() {
        String u = failedUrl;
        if (u == null) return;
        failedUrl = null;
        web.loadUrl(u);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        instance = this;
        prefs = getSharedPreferences("mymusic", MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0B0F);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " MyMusicApp/1.1");
        web.addJavascriptInterface(new Bridge(), "AndroidMusic");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (ours(u.getHost()) && "https".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap f) { v.setBackgroundColor(0xFF0B0B0F); }
            // The page itself failed to load (no internet, server down): show a retry screen instead of the browser's error.
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showError(r.getUrl().toString());
            }
            @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {
                if (r.isForMainFrame() && e.getStatusCode() >= 500) showError(r.getUrl().toString());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest r) { r.deny(); }
        });
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            netCb = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { web.post(() -> retryNow()); }
            };
            try { cm.registerDefaultNetworkCallback(netCb); } catch (Exception ignored) { netCb = null; }
        }
        if (b != null) web.restoreState(b); else web.loadUrl(startUrl(getIntent()));
    }

    /** A tapped player link (https://bot.text.bz/player/…) opens straight in the app. */
    private String startUrl(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d != null && ours(d.getHost()) && d.getPath() != null && d.getPath().startsWith("/player/")) return d.toString();
        String link = prefs.getString("link", "");
        if (!link.isEmpty()) return "https://" + HOST + "/player/" + link;
        // First start after the move to playlist.bz: fetch the link saved under the old address once.
        if (!prefs.getBoolean("migrated", false)) return OLD_HOME;
        return HOME;
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        Uri d = i.getData();
        if (d != null) web.loadUrl(startUrl(i));
    }

    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    // Deliberately no webView.onPause(): the music must keep playing with the screen off.
    @Override protected void onResume() { super.onResume(); web.onResume(); web.resumeTimers(); }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); // the web app closes its sheets/pages on history back
        else moveTaskToBack(true);          // never finish(): playback continues
    }

    @Override protected void onDestroy() {
        if (netCb != null) { try { ((ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCb); } catch (Exception ignored) { } }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /** Called by the notification / lock screen / headset: drives the web player. */
    static void command(final String cmd) {
        final MainActivity a = instance;
        if (a == null || a.web == null) return;
        a.web.post(() -> a.web.evaluateJavascript("window.__nativeCmd&&window.__nativeCmd('" + cmd + "')", null));
    }

    /** window.AndroidMusic in the page. */
    class Bridge {
        @JavascriptInterface public void state(boolean playing, String title, String artist, String cover) {
            PlaybackService.update(getApplicationContext(), playing, title, artist, cover);
        }
        @JavascriptInterface public String clipboard() {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip()) return "";
            ClipData.Item it = cm.getPrimaryClip().getItemAt(0);
            CharSequence t = it == null ? null : it.coerceToText(MainActivity.this);
            return t == null ? "" : t.toString();
        }
        @JavascriptInterface public String version() { return "1.1.0"; }
        /** The launcher remembers the player link here too, so it survives a change of address. */
        @JavascriptInterface public void saveLink(String t) { prefs.edit().putString("link", t == null ? "" : t.trim()).putBoolean("migrated", true).apply(); }
        @JavascriptInterface public String link() { return prefs.getString("link", ""); }
        @JavascriptInterface public void markMigrated() { prefs.edit().putBoolean("migrated", true).apply(); }
        @JavascriptInterface public void retry() { runOnUiThread(() -> retryNow()); }
    }
}
