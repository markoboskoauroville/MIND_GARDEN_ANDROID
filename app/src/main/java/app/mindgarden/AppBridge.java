package app.mindgarden;

import android.app.Activity;
import android.app.AlertDialog;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;

/** MGApp for the page: "More online: scores and voices" opens the website in the phone's browser. */
public class AppBridge {
    private final Activity act;
    private final WebView web;

    AppBridge(Activity act, WebView web) { this.act = act; this.web = web; }

    /** Opens a path of https://mindgarden.markobosko.org in the browser. Only a plain path is taken from the page:
     *  the scheme and the host are fixed here (SiteUrl.forPath). Returns false when the path is refused.
     *  Without internet the browser is not opened: one plain line says the page needs the internet. */
    @JavascriptInterface public boolean openWeb(String path) {
        final String url = SiteUrl.forPath(BuildConfig.SITE, path);
        if (url == null) return false;
        openOnline(act, web, url);
        return true;
    }

    @JavascriptInterface public String version() { return String.valueOf(BuildConfig.VERSION_CODE); }

    /** The site is reachable (a TCP connection to its port 443 within 3 s): open it; else say plainly that it needs the internet.
     *  (navigator.onLine is not used: in a WebView it says true even in airplane mode, measured 22.11.2026.) */
    static void openOnline(Activity act, WebView web, String url) {
        new Thread(() -> {
            boolean online;
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(new URL(BuildConfig.SITE).getHost(), 443), 3000);
                online = true;
            } catch (Exception e) { online = false; }
            final boolean ok = online;
            act.runOnUiThread(() -> {
                if (ok) { MainActivity.openInBrowser(act, url); return; }
                web.evaluateJavascript("document.documentElement.lang", lang -> {
                    if (act.isFinishing()) return;
                    new AlertDialog.Builder(act).setMessage(needsInternet(lang))
                        .setPositiveButton(android.R.string.ok, null).show();
                });
            });
        }).start();
    }

    /** "This needs the internet." in the six languages of the game (lang as the page reports it, e.g. "\"hr\""). */
    static String needsInternet(String lang) {
        String l = lang == null ? "" : lang.replace("\"", "");
        switch (l) {
            case "hr": return "Za ovo treba internet. Spoji se na internet i pokušaj ponovo.";
            case "de": return "Dafür braucht es Internet. Verbinde dich mit dem Internet und versuche es noch einmal.";
            case "fr": return "Il faut Internet pour cela. Connecte-toi à Internet et réessaie.";
            case "es": return "Para esto se necesita internet. Conéctate a internet y vuelve a intentarlo.";
            case "it": return "Per questo serve internet. Collegati a internet e riprova.";
            default:   return "This needs the internet. Connect to the internet and try again.";
        }
    }
}
