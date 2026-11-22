# Mind Garden (Android): TAKEOVER

The Android shell of the game Mind Garden: the offline app for registered people. This public repository holds ONLY the
shell (Java, manifest, Gradle, the workflow, the sync and check scripts). It holds no game, no audio, no key, no secret.
The game itself comes, at build time, from the private web repository, so the website and the app are one source.
No README on purpose (MANTRA_MANIFEST repo-privacy.md: a public repository that is not promoted has none).

Started 22.11.2026 (Opus worker of the Fable master session). Marko's words: `momentaryupdates.md`.

## The design in nine lines

1. **One source.** The workflow fetches the web repo at the exact commit in `web.lock`, copies its `public/` into
   `app/src/main/assets/www` untouched and writes only one file of its own, `www/mode.js` (MG_MODE "app": login false,
   globalScores false, onlineVoices false, bridge true, updater true, bundledAudio true). Nothing of the game is committed here.
2. **Drift check.** `www.sha256` (sha256 over every file's path and content hash, without mode.js; `scripts/www_hash.py`) and
   `web_commit.txt` go into the APK. After the build `scripts/check_apk.py` unzips the APK and compares its `assets/www`
   with a separate `git archive` of the web commit: any difference and the run is red.
3. **Parity.** `scripts/check_parity.py` reads the web repo's `tests/parity.json` at that commit; every feature listed for
   "app" or "both" must be in the built folder (file + marker), or the run is red.
4. **One version number.** The web repo's `VERSION` file at the web commit is the app's versionCode and name (whole
   numbers). The workflow fails if it is not above 12 (v12, the old shell) or below the floor `appVersion` in
   `gradle.properties` (raise the floor after each release). The web jumped 9 to 13 on 22.11.2026 so the two share one
   number from 13 on. A version already kept in the files repo from another web commit is refused: a released number is never reused.
5. **Signing continuity.** Signed with the same certificate as v11 and v12 (SHA-256 `1ee11251...5a624a`, checked after
   every build), so it installs over them and every phone keeps its players and progress.
6. **Registered people only.** No release, no artifact, nothing of the APK on GitHub public. The APK and app.json are
   kept in a private data repository (the store of record) and sent to the site's private store by a signed upload; the
   site serves it behind the login at `/app` (download page) and `/app/download`.
7. **The updater changed.** The app installs nothing (no install permission). At start it reads the site's public
   `/app/version.json` (`{"version":N,"date":"..."}`); if N is higher, the game's own update box asks
   "A new version is available. Open the download page?" and Yes opens `/app` in the phone's browser. Offline: silent.
8. **Only the game loads.** The WebView refuses every request that is not `file:///android_asset/www/...` (so the web's
   remote speechify-keys script, `/api/...` calls and `/favicon.svg` never run or load in the app). Links to the site
   open in the browser; nothing else opens.
9. **Margins and portrait.** System bars + camera cutout + 16 dp on all four sides; portrait only; targetSdk 35.

## The secrets (names and purpose, never the values)

| Secret of this repo | What it is | Can do |
|---|---|---|
| `WEB_DEPLOY_KEY` | private half of an SSH deploy key on MIND_GARDEN_WEB, **read only** | read the web repo, nothing else |
| `FILES_DEPLOY_KEY` | private half of an SSH deploy key on the files repo, **write**, that repo only | push the APK and app.json there |
| `MG_KEYSTORE_B64` | base64 of `keystore/mindgarden.keystore` of kognius_app (the v11/v12 certificate) | sign the APK |
| `APP_UPLOAD_KEY` | 64 hex characters, the shared HMAC key; the same value is a Pages secret of the site | upload an APK chunk and finish; reads nothing |

Repository variable `UPLOAD_LIVE` = `1` turns the site upload on (the route must exist). Only pushes to main of this
repository run the workflow (no pull_request trigger, no inputs), so a fork or a pull request never sees a secret.

**The key is the public Android debug key.** The certificate of v11/v12 is the standard `androiddebugkey` (password
"android"), the same that every Android SDK makes. It protects nothing: anyone can sign a forged APK that installs over
this app. It is kept now because a new key means every phone must uninstall once and loses its local players and
progress. Moving to a real key is **a decision left for Marko**, and comes with a progress export first (a button that
writes the players and progress to a file, and an import in the new app).

## How a web change becomes a new APK (step by step)

1. The web worker releases a new web version on MIND_GARDEN_WEB main with `VERSION` raised (whole number, e.g. 14).
2. Here: put that commit's full sha into `web.lock`, raise `appVersion` in `gradle.properties` to the same number, commit, push to main.
3. The workflow runs (Actions tab, "Android APK"): rules, fetch, version, files repo, sync, parity, upload test, sign,
   unit tests, APK, APK checks, (a) keep, (b) upload, (c) the site says the new number. Green = done.
4. Red at (b) or (c) after (a): re-run the workflow (Actions, "Re-run all jobs"); it finds the version kept and uploads
   that file without rebuilding.
5. Phones with the app see the question at their next start (online). A phone on v12 does not (see below).

## The upload rule (the same text is in `scripts/upload_apk.py` and in the web repo)

`POST /app/upload/<version>/<index>` (chunks of at most 1,048,576 bytes, index from 0) and `POST /app/upload/<version>/finish`
(the app.json fields + `"chunks"`). Headers `X-MG-Time` (unix seconds) and `X-MG-Sig` = hex HMAC-SHA256 with the 32 bytes of
`APP_UPLOAD_KEY` over `"POST\n" + path + "\n" + time + "\n" + sha256hex(body)`. The site refuses: more than 300 s away or a
bad signature (401), a version not higher than the served one (409), a chunk too big (413), a finish that does not match
(422). Known answer: key bytes 0x00..0x1f, path `/app/upload/13/0`, time 1763800000, body `hello` →
`2d8f29ad8f117b5a524705c79b42bbf602ef505397931a5cc250d0cba38443e6`. `scripts/test_upload.py` checks all of it against a
local stand-in in every run.

## The files repo (store of record)

Private data repository; `apk/mindgarden-v<N>.apk`, `apk/mindgarden-v<N>.json`, and `app.json` (the newest). Plain
commits, every file under 100 MB. Rollback = upload a kept file again. Pruning: keep the last five versions; older ones
are removed with a history rewrite **only when Marko asks**, never automatically.

| Version | Web commit | APK size | Date |
|---|---|---|---|
| 13 | 674df7a | (filled after the first green run) | 22.11.2026 |

## What is in the app, what is not, and why

In the app (offline): the whole game, the six-language row and the motto, players and progress on the phone, the
recorded clips of all six languages, the phone's own voice for "Welcome, name", the back button, the confirm dialogs.
Not in the app: Google sign-in, Global scores, progress saved with the login, the online voices, the donation bowl,
install-from-browser, the web's service worker. Why: they need the server and the login; the app is the offline game.
The tile "More online: scores and voices" (from the web source, app mode only) opens the website in the browser.

## v12 phones

v12 reads a `latest.json` pointer on an open Google Drive folder. That pointer is NOT pointed at the new APK (it would
publish it). v12 phones learn of v13 from Marko, or from one last notice-only v12-style build (master's decision).

## No downgrades (what v12 did, each pinned in `scripts/check_rules.py`)

Same app id; same page address (progress survives); native back button through `window.appBack`; native confirm and alert
(the v12 confirm() fix); MGTts, the phone's voice; recorded clips offline; players and per-player progress (web source,
parity `players`); the on-device test runner (WebView debugging on, as in v12); portrait; screen kept on. Dropped by
design: the self-installing updater (replaced by "open the download page"), the remote speechify-keys script (blocked).

## Next

- The site's upload route, `/app`, `/app/download`, `/app/version.json` (web worker); then the variable UPLOAD_LIVE = 1.
- A progress export, before any change of the signing key (Marko's decision).
