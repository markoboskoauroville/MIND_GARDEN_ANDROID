package app.mindgarden;

import android.app.Activity;
import android.webkit.JavascriptInterface;

/** MGApp for the page: "More online: scores and voices" opens the website in the phone's browser. */
public class AppBridge {
    private final Activity act;

    AppBridge(Activity act) { this.act = act; }

    /** Opens a path of https://mindgarden.markobosko.org in the browser. Only a plain path is taken from the page:
     *  the scheme and the host are fixed here (SiteUrl.forPath). Returns false when the path is refused. */
    @JavascriptInterface public boolean openWeb(String path) {
        final String url = SiteUrl.forPath(BuildConfig.SITE, path);
        if (url == null) return false;
        act.runOnUiThread(() -> MainActivity.openInBrowser(act, url));
        return true;
    }

    @JavascriptInterface public String version() { return String.valueOf(BuildConfig.VERSION_CODE); }
}
