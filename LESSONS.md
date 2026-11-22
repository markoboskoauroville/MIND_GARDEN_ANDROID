# Mind Garden (Android): LESSONS

- **22.11.2026. Artifacts of a public repository are downloadable by any signed-in GitHub user.** So an APK meant only for
  registered people can never be a release or a plain artifact here. It goes to a private data repo and to the site.
- **22.11.2026. Cloudflare R2 is not enabled on the account** ("Please enable R2 through the Cloudflare Dashboard"). Marko:
  "Please use GitHub, repositories as storage space for my web pages." KV holds at most 25 MB a value; the APK is bigger.
  So the site keeps the APK in chunks of 1 MB (D1), sent by a signed upload.
- **22.11.2026. localStorage of a WebView belongs to the page's origin.** v1..v12 loaded `file:///android_asset/www/index.html`.
  Moving to WebViewAssetLoader (https://appassets...) would be cleaner but would lose every phone's players and progress.
  The address stays; `scripts/check_rules.py` pins it.
- **22.11.2026. aapt drops asset files whose names start with "." or "_" by default.** `ignoreAssetsPattern` is set so the
  whole game folder goes in, and the drift check would catch any file that does not.
- **22.11.2026. The web and the app had two numbers (web 9, app 12).** One number from 13: the web's `VERSION` file.
- **22.11.2026. Play Protect** warns about apps not from the Play Store and dislikes `REQUEST_INSTALL_PACKAGES`. Removing that
  permission, targetSdk 35, a stable certificate and a description make a block less likely; nothing outside the Play
  Store removes the "unknown app" warning.
- **22.11.2026. An emulator without `-no-audio` plays on Marko's speakers.** A chime (Play Protect's dialog on the headless
  emulator) disturbed him while he listened to music. Every emulator is started with `-no-audio`; sound is proven from the
  player's state, never by playing it into his room.
- **22.11.2026. `navigator.onLine` says true inside a WebView in airplane mode** (measured on API 35). The "needs internet" line
  is decided natively (a 3 s connection to the site's port 443).
- **22.11.2026. Another worker attached to this app's WebView through DevTools** and forced a navigation to its preview site;
  the request filter refused it. Since v14 the release is not debuggable at all; only the debug variant is, for tests.
- **22.11.2026. The site uses the key as text and the timestamp in milliseconds.** The first draft of the upload used the
  hex-decoded bytes and seconds: it would have been refused. A word-for-word copy of the web's signing function is now one
  of the stand-in checks, so the two sides cannot drift apart silently.
- **22.11.2026. The Download Monitor rule was missed:** about 100 MB of APKs were pulled from the files repo with `git pull`
  without registering them first. Every download (git, gh, curl) is registered on the Download Monitor first
  (`dlmon.py add ...`), and before any pull over 50 MB the size is read first (`gh api repos/.../contents/apk` or app.json's
  size) and the big-downloads route rule followed (`route -n get default`, the Nothing line without Connection Keeper).
- **22.11.2026. The v12 device runner's two "practice" failures were the runner, not the app:** `--quick` answered 4 questions of
  a 10-question round and then waited for a result screen that only comes after 10. Looked at by hand on v14 first.
- **Round 1 (22.11.2026): 9 of 10** from the Fable master. Yes: the job against independent truths (game hash = web commit,
  openssl known answer, the site's sha256 over its stored chunks = the built APK), errors never silent, margins, accessible
  controls, workflow green with a whole number (no Latest release by Marko's order), update at start, documents, the pins hold
  (check_rules + drift check, in place of the Queen point, which does not apply to a build pipeline), nothing left behind.
  No: the install on a real phone, which is Marko's hand (steps in TAKEOVER).
