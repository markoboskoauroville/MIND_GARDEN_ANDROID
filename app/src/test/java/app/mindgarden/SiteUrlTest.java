package app.mindgarden;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SiteUrlTest {
    private static final String SITE = "https://mindgarden.markobosko.org";

    @Test public void plainPathsOnTheSiteOpen() {
        assertEquals(SITE + "/", SiteUrl.forPath(SITE, "/"));
        assertEquals(SITE + "/app", SiteUrl.forPath(SITE, "/app"));
        assertEquals(SITE + "/app/version.json", SiteUrl.forPath(SITE, "/app/version.json"));
        assertEquals(SITE + "/?lang=hr#top", SiteUrl.forPath(SITE, "/?lang=hr#top"));
    }

    @Test public void noSchemeOrHostFromJavaScript() {
        String[] bad = { null, "", "app", "https://evil.example/", "http://mindgarden.markobosko.org/", "//evil.example/x",
            "/\\evil.example", "/@evil.example", "/x:y", "javascript:alert(1)", "/../x", "/a/../../b", "/a/./b",
            "/ space", "/x\n", "file:///etc/hosts", "intent://x#Intent;end", "/%0d%0a", "data:text/html,x" };
        for (String p : bad) assertNull(String.valueOf(p), SiteUrl.forPath(SITE, p));
    }

    @Test public void onlyBundledFilesLoad() {
        assertTrue(SiteUrl.isBundled("file:///android_asset/www/index.html"));
        assertTrue(SiteUrl.isBundled("file:///android_asset/www/audio/hr/hello.mp3"));
        assertFalse(SiteUrl.isBundled("https://speechifykeys.pages.dev/speechify-keys.js"));
        assertFalse(SiteUrl.isBundled("file:///favicon.svg"));
        assertFalse(SiteUrl.isBundled("file:///api/me"));
        assertFalse(SiteUrl.isBundled("file:///android_asset/www/../x"));
        assertFalse(SiteUrl.isBundled("file:///data/data/app.mindgarden/x"));
        assertFalse(SiteUrl.isBundled(null));
    }

    @Test public void versionParsing() {
        assertEquals(14, SiteUrl.parseVersion("{\"version\":14,\"date\":\"2026-11-22\"}"));
        assertEquals(13, SiteUrl.parseVersion("{ \"date\": \"x\", \"version\" : 13 }"));
        assertEquals(-1, SiteUrl.parseVersion("<html>login</html>"));
        assertEquals(-1, SiteUrl.parseVersion(null));
    }

    @Test public void testOverrideOnlyLoopback() {
        assertEquals("http://10.0.2.2:8899/version.json", SiteUrl.testOverride("http://10.0.2.2:8899/version.json"));
        assertNull(SiteUrl.testOverride("https://evil.example/version.json"));
        assertNull(SiteUrl.testOverride("http://10.0.2.2.evil.example:80/x"));
    }
}
