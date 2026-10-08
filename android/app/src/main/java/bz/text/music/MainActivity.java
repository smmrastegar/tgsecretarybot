package bz.text.music;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * My Music: a thin native shell around https://bot.text.bz/listen.
 * The web player does everything; the shell adds what a browser tab cannot:
 * keeps playing with the screen off (foreground service), lock-screen /
 * notification / headset controls, opening player links from chats, and Back
 * that never kills the music.
 */
public class MainActivity extends Activity {
    static final String HOST = "bot.text.bz";
    static final String HOME = "https://" + HOST + "/listen";
    static MainActivity instance;
    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        instance = this;
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
        s.setUserAgentString(s.getUserAgentString() + " MyMusicApp/1.0");
        web.addJavascriptInterface(new Bridge(), "AndroidMusic");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost()) && "https".equals(u.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap f) { v.setBackgroundColor(0xFF0B0B0F); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest r) { r.deny(); }
        });
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        if (b != null) web.restoreState(b); else web.loadUrl(startUrl(getIntent()));
    }

    /** A tapped player link (https://bot.text.bz/player/…) opens straight in the app. */
    private String startUrl(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d != null && HOST.equals(d.getHost()) && d.getPath() != null && d.getPath().startsWith("/player/")) return d.toString();
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
        @JavascriptInterface public String version() { return "1.0.0"; }
    }
}
