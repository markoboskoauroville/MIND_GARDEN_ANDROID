package app.mindgarden;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.util.Collections;

/**
 * Mind Garden, the offline app: the game of the website (assets/www, copied at build time from the web repo) in a WebView.
 * The page is loaded from the same address as v1..v12 (file:///android_asset/www/index.html), so the phone's saved players
 * and progress (localStorage of that origin) are the same after the update.
 * Only the game's own files load; any other request is refused, so no remote script ever runs beside the bridges.
 * Bridges: MGTts (the phone's voice), MGUpdate (is there a newer version? open the download page), MGApp (open the website).
 */
public class MainActivity extends Activity {
    static final String START = "file:///android_asset/www/index.html";
    private WebView web;
    private Tts tts;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WebView.setWebContentsDebuggingEnabled(true); // as v12: the on-device test runner reads the page over adb
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // players and progress are saved in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);                    // the game has its own text-size setting
        s.setAllowFileAccess(true);            // the game is in file:///android_asset/www
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        web.setBackgroundColor(0xFF0E0E11);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                String url = r.getUrl().toString();
                if (SiteUrl.isBundled(url)) return null;
                if (url.startsWith("data:") || url.startsWith("blob:")) return null;
                return new WebResourceResponse("text/plain", "utf-8", 403, "Not in the app",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String url = r.getUrl().toString();
                if (SiteUrl.isBundled(url)) return false;
                if (url.startsWith(BuildConfig.SITE + "/")) openInBrowser(MainActivity.this, url);
                return true;                       // nothing else is ever opened inside the app
            }
        });
        // Without a WebChromeClient, confirm() always answers "no": removing a player or resetting progress would never work (v12 fix).
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView v, String url, String message, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setCancelable(false)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm())
                    .setNegativeButton(android.R.string.cancel, (d, w) -> r.cancel()).show();
                return true;
            }
            @Override public boolean onJsAlert(WebView v, String url, String message, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setCancelable(false)
                    .setPositiveButton(android.R.string.ok, (d, w) -> r.confirm()).show();
                return true;
            }
        });
        tts = new Tts(this);
        web.addJavascriptInterface(tts, "MGTts");
        web.addJavascriptInterface(new VersionCheck(this, web, getIntent().getStringExtra("version_url")), "MGUpdate");
        web.addJavascriptInterface(new AppBridge(this), "MGApp");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0E0E11);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        margins(root);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    /** System bars + camera cutout + 16 dp on all four sides (MANTRA_MANIFEST android-app.md §3a, system-bars.md). */
    private void margins(View root) {
        final int m = Math.round(16 * getResources().getDisplayMetrics().density);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, in) -> {
                Insets b = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(b.left + m, b.top + m, b.right + m, b.bottom + m);
                return WindowInsets.CONSUMED;
            });
        } else {
            root.setPadding(m, m, m, m);       // Android 8 to 10 lay the window out between the bars by themselves
        }
    }

    static void openInBrowser(Context ctx, String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(ctx, R.string.no_browser, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : 'exit'", result -> {
            if (result == null || result.contains("exit")) finish();
        });
    }
}
