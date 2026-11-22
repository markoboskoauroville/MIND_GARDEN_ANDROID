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
