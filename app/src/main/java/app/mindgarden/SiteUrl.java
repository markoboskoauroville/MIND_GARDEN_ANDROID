package app.mindgarden;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The rules the app keeps about addresses, with no Android in them so they are tested on a desk (SiteUrlTest).
 * Nothing here takes a scheme or a host from JavaScript: the site is fixed, the page may only name a path on it.
 */
final class SiteUrl {
    private SiteUrl() { }

    /** a plain path on the site: /, /app, /app/version.json, /some/page?x=1#top. No "//", "..", "\", "@", ":" or spaces. */
    private static final Pattern PATH = Pattern.compile("/[A-Za-z0-9/_.~-]{0,200}(\\?[A-Za-z0-9=&_.~%-]{0,200})?(#[A-Za-z0-9_-]{0,60})?");

    /** The full address on the site for a path the page asked for, or null when the path is not a plain path. */
    static String forPath(String site, String path) {
        if (path == null || !PATH.matcher(path).matches()) return null;
        if (path.startsWith("//") || path.contains("..") || path.contains("/./")) return null;
        return site + path;
    }

    /** Only the game's own files may load inside the app; everything else is refused (no remote script beside the bridges). */
    static boolean isBundled(String url) {
        if (url == null || !url.startsWith("file:///android_asset/www/")) return false;
        String rest = url.substring("file:///android_asset/www/".length());
        return !rest.contains("..") && !rest.contains("%2e") && !rest.contains("%2E");
    }

    private static final Pattern VERSION = Pattern.compile("\"version\"\\s*:\\s*(\\d{1,6})\\b");

    /** The version number in the site's /app/version.json ({"version":N,"date":"..."}), or -1. */
    static int parseVersion(String body) {
        if (body == null || body.length() > 4096) return -1;
        Matcher m = VERSION.matcher(body);
        return m.find() ? Integer.parseInt(m.group(1)) : -1;
    }

    /** The test address may only be the emulator's own loopback, never a real host given from outside. */
    static String testOverride(String url) {
        return url != null && url.matches("http://10\\.0\\.2\\.2:\\d{2,5}/[A-Za-z0-9/_.-]{0,100}") ? url : null;
    }
}
