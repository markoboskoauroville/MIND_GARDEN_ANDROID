package app.mindgarden;

import android.app.Activity;
import android.content.pm.PackageManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * MGUpdate for the page (the same three calls as v12's updater, so the game's own update box is reused):
 *   check()    at start: reads the site's public /app/version.json (a number and a date, nothing else); when it is
 *              higher than this app, the page shows "A new version is available. Open the download page?".
 *              Offline, or any answer that is not a number: nothing is said.
 *   install()  opens the site's download page (/app) in the phone's browser: the person signs in there and downloads.
 *   version()  this app's version number.
 * The app never downloads or installs an APK itself (no REQUEST_INSTALL_PACKAGES): the APK is behind the login.
 */
public class VersionCheck {
    private final Activity act;
    private final WebView web;
    private final String versionUrl;
    private volatile boolean busy;

    VersionCheck(Activity act, WebView web, String testUrl) {
        this.act = act; this.web = web;
        String t = SiteUrl.testOverride(testUrl);
        this.versionUrl = t != null ? t : BuildConfig.SITE + "/app/version.json";
    }

    private int installed() {
        try { return (int) act.getPackageManager().getPackageInfo(act.getPackageName(), 0).getLongVersionCode(); }
        catch (PackageManager.NameNotFoundException e) { return BuildConfig.VERSION_CODE; }
    }

    @JavascriptInterface public String version() { return String.valueOf(installed()); }

    @JavascriptInterface public void check() {
        if (busy) return; busy = true;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(versionUrl).openConnection();
                c.setInstanceFollowRedirects(false);          // a login page or any redirect is not an answer
                c.setConnectTimeout(8000); c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/json");
                if (c.getResponseCode() != 200) return;
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] buf = new byte[1024]; int n;
                    while ((n = in.read(buf)) > 0 && b.size() < 4096) b.write(buf, 0, n);
                }
                int newest = SiteUrl.parseVersion(b.toString("UTF-8"));
                if (newest > installed()) {
                    final String code = "window.onUpdate && window.onUpdate('ready','" + newest + "')";
                    web.post(() -> web.evaluateJavascript(code, null));
                }
            } catch (Exception ignored) {
                // offline or no answer: nothing is said
            } finally { busy = false; }
        }).start();
    }

    @JavascriptInterface public void install() {
        act.runOnUiThread(() -> {
            AppBridge.openOnline(act, web, BuildConfig.SITE + "/app");
            web.evaluateJavascript("(function(){var d=document.getElementById('updAsk');if(d)d.remove();})()", null);
        });
    }
}
