# Mind Garden (Android): TAKEOVER

The Android shell of the game Mind Garden: the offline app for registered people. This public repository holds ONLY the
shell (Java, manifest, Gradle, the workflow, the sync and check scripts). It holds no game, no audio, no key, no secret.
The game itself comes, at build time, from the private web repository, so the website and the app are one source.
No README on purpose (MANTRA_MANIFEST repo-privacy.md: a public repository that is not promoted has none).

Started 22.11.2026 (Opus worker of the Fable master session). Marko's words: `momentaryupdates.md`.

## The design in ten lines

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
9. **Not debuggable.** The release's WebView cannot be attached from a computer (WebView debugging only when the build is
   debuggable; `check_apk.py` fails a debuggable release). Proven 22.11.2026: a navigation forced from outside through
   DevTools (another worker's test) to an https address loaded nothing inside the app ("Webpage not available",
   ERR_HTTP_RESPONSE_CODE_FAILURE): the request filter holds even then.
10. **Margins and portrait.** System bars + camera cutout + 16 dp on all four sides; portrait only; targetSdk 35.

## The secrets (names and purpose, never the values)

| Secret of this repo | What it is | Can do |
|---|---|---|
| `WEB_DEPLOY_KEY` | private half of an SSH deploy key on MIND_GARDEN_WEB, **read only** | read the web repo, nothing else |
| `FILES_DEPLOY_KEY` | private half of an SSH deploy key on the files repo, **write**, that repo only | push the APK and app.json there |
| `MG_KEYSTORE_B64` | base64 of `keystore/mindgarden.keystore` of kognius_app (the v11/v12 certificate) | sign the APK |
| `APP_UPLOAD_KEY` | 64 hex characters, the shared HMAC key; the same value is a Pages secret of the site | upload an APK chunk and finish; reads nothing |

Two deploy keys, each for one repository with the least right: `MIND_GARDEN_ANDROID CI (read only)` on MIND_GARDEN_WEB and
`MIND_GARDEN_ANDROID CI (write)` on MIND_GARDEN_FILES (`gh repo deploy-key list -R <repo>` shows them).

**When a key must be replaced** (leaked, lost, or a worker in doubt): never print or file it; each in one command block in a
private temp folder deleted at the end.
- A deploy key: `ssh-keygen -t ed25519 -N "" -f $D/k`; `gh repo deploy-key add $D/k.pub -R markoboskoauroville/<repo> -t "<same title>"`
  (`--allow-write` only for the files repo); `gh secret set <WEB|FILES>_DEPLOY_KEY -R markoboskoauroville/MIND_GARDEN_ANDROID < $D/k`;
  then delete the old key (`gh repo deploy-key delete <id> -R <repo>`); push or re-run to prove it.
- `APP_UPLOAD_KEY`: make 64 random hex characters into a file (mode 600, no newline), set it here with
  `gh secret set APP_UPLOAD_KEY ... < file` and give the same file to the web side for the Pages secret
  (`wrangler pages secret put APP_UPLOAD_KEY`), which deletes it. Until both sides have it, uploads are refused (401), nothing breaks.
- `MG_KEYSTORE_B64`: only from the same keystore (kognius_app `keystore/mindgarden.keystore`): `base64 -i <keystore> | tr -d '\n' |
  gh secret set MG_KEYSTORE_B64 ...`. A different keystore would make every phone uninstall and lose progress: Marko's decision only.

Repository variable `UPLOAD_LIVE` = `1` turns the site upload on (the route must exist). Only pushes to main of this
repository run the workflow (no pull_request trigger, no inputs), so a fork or a pull request never sees a secret.

**The key is the public Android debug key.** The certificate of v11/v12 is the standard `androiddebugkey` (password
"android"), the same that every Android SDK makes. It protects nothing: anyone can sign a forged APK that installs over
this app. It is kept now because a new key means every phone must uninstall once and loses its local players and
progress. Moving to a real key is **a decision left for Marko**, and comes with a progress export first (a button that
writes the players and progress to a file, and an import in the new app).

## When the app is rebuilt (rule of 22.11.2026)

The app is rebuilt when a web release changes something the app shows, or when the shell changes. Its number is then the
web version it is built from. Web and app may differ by a number in between (web 15 changed only a tile underline and an
admin table, which the app does not show, so the app stayed 14). `web.lock` and the floor `appVersion` move at that next build.

## How a web release becomes an APK (step by step, for a fresh worker)

1. Read the web repo's release: `git -C ~/Developer/MIND_GARDEN_WEB log origin/main`, its `VERSION` (say N) and what changed in
   `public/`. Nothing the app shows changed and no shell change: stop, no build.
2. Here, on main: write that commit's full 40-character sha into `web.lock`; set `appVersion=N` in `gradle.properties`.
3. Commit and push to main (a push that changes only `.md` files does not run the build).
4. The workflow "Android APK" runs: rules, fetch the web at web.lock (read-only key), version, files repo check, copy the game,
   parity, upload stand-in test, sign, unit tests, release + debug APK, APK checks (certificate, version, INTERNET only, not
   debuggable, game hash = web commit), (a) keep in the files repo, (b) signed upload to the site, (c) the site's
   /app/version.json says N. Green = done. Link and colour go to Marko.
5. Red after (a): re-run it (`gh run rerun <id> -R markoboskoauroville/MIND_GARDEN_ANDROID`): it finds vN kept from the same web
   commit and uploads that file without rebuilding. A re-run after success stays green (the live version again is a no-op).
6. Proof on the emulator (`-no-audio`, own port): the debug variant from the files repo `test/` for `node tests/device/run.js`,
   the release over the previous version for the update path. Update the version table below.
7. A released number is never reused: a build of another web commit under a kept number is refused; raise the number.

## The upload rule (the site's lib/app.js and tools/app_sign.py; `scripts/upload_apk.py` sends the same bytes)

`POST /app/upload/<version>/<index>` (chunks of at most 1,048,576 bytes, index from 0) and `POST /app/upload/<version>/finish`
with exactly `{"chunks","size","sha256","date","web_commit"}`. Headers `X-MG-Timestamp` (milliseconds since 1970) and
`X-MG-Signature` = hex HMAC-SHA256 with the key TEXT `APP_UPLOAD_KEY` (64 hex characters, used as UTF-8 text, not decoded)
over `"POST\n" + path + "\n" + timestamp + "\n" + sha256hex(body)`, and a real `User-Agent` (Cloudflare refuses
python-urllib's default). The site refuses an old timestamp (5 min) or a bad signature, a version not higher than the live
one (409), a chunk too big (413), a finish that does not match (422), and answers 503 while its key is not set. Known
answer: key text `0123456789abcdef` four times, path `/app/upload/14/0`, timestamp `1763800000000`, body `hello` →
`29d7eb2262d95603dc5746da664b18b46e5637da130f267d74982f2ec33e247f` (openssl). `scripts/test_upload.py` checks all of it,
and a word-for-word copy of the web's `signed_post`, against a local stand-in in every run.

## Closing proof of v14 (22.11.2026)

Built by run 45004381044 from web d24f948; kept in the files repo; uploaded in 33 signed chunks; the site's
/app/version.json answers {"version":14,"date":"2026-11-22"}. The web worker computed the sha256 from production's own
stored chunks: `4abae99f514cd58d0f9bf39509012f54d99d1fbd32b961f17ea41816e15e1e71` over 33,979,669 bytes, the same as the
built APK, and the real file came back byte-identical through the preview's /app/download as `MindGarden-v14.apk`.
On the emulator the release installed over v12 and kept the player Emina and her progress.

## Steps for Marko's own phone (one action each)

1. On the phone, open https://mindgarden.markobosko.org/app in Chrome and sign in with an invited Google account.
2. Tap the Download tile.
3. Open the downloaded file; if Android asks, allow Chrome to install apps.
4. Tap Update (it installs over v12; do not uninstall first).
5. If Play Protect warns, tap "More details", then "Install anyway".
6. Open Mind Garden and check that the players and their progress are there.
7. Tell what Play Protect showed, if anything.

## The files repo (store of record)

Private data repository; `apk/mindgarden-v<N>.apk`, `apk/mindgarden-v<N>.json`, and `app.json` (the newest). Plain
commits, every file under 100 MB. Rollback = upload a kept file again. Pruning: keep the last five versions; older ones
are removed with a history rewrite **only when Marko asks**, never automatically.

| Version | Web commit | APK size | Date |
|---|---|---|---|
| 13 | 674df7a | 33,977,969 bytes | 22.11.2026 (test build: debuggable WebView, never uploaded to the site) |
| 14 | d24f948 | 33,979,669 bytes, sha256 4abae99f...1e71 | 22.11.2026 (live on the site) |

`test/mindgarden-v<N>-debug.apk` beside each release: the debug variant (same code, same certificate, WebView debuggable)
for the on-device test runner and the emulator proofs. It is never uploaded to the site and never given to anybody.

## What is in the app, what is not, and why

In the app (offline): the whole game, the six-language row, players and progress on the phone, the
recorded clips of all six languages, the phone's own voice for "Welcome, name", the back button, the confirm dialogs.
Not in the app: Google sign-in, Global scores, progress saved with the login, the online voices, the donation bowl,
install-from-browser, the web's service worker. Why: they need the server and the login; the app is the offline game.
The tile "More online: scores and voices" (from the web source, app mode only) opens the website in the browser.

## v12 phones

v12 reads a `latest.json` pointer on an open Google Drive folder. That pointer is left alone (pointing it at the new APK
would publish it). Decided 22.11.2026: Marko tells the few v12 users himself; no notice-only build.

## No downgrades (what v12 did, each pinned in `scripts/check_rules.py`)

Same app id; same page address (progress survives); native back button through `window.appBack`; native confirm and alert
(the v12 confirm() fix); MGTts, the phone's voice; recorded clips offline; players and per-player progress (web source,
parity `players`); the on-device test runner (with the debug variant, test/mindgarden-v<N>-debug.apk; the release is no longer debuggable); portrait; screen kept on. Dropped by
design: the self-installing updater (replaced by "open the download page"), the remote speechify-keys script (blocked).

## Testing on the emulator (the rules learned on 22.11.2026)

- Start it **always with `-no-audio`** (`emulator -avd Pixel_7_API_35 -port <own port> -no-window -no-audio`): an emulator
  without it plays on Marko's speakers; on 22.11.2026 a chime (Play Protect's dialog) disturbed him while he listened to music.
  Sound is proven from the player's state (the audio element's currentTime advancing to its duration, audio focus held by
  app.mindgarden in `dumpsys audio`), never by raising a volume.
- The device test runner lives here: `node tests/device/run.js --serial emulator-<port> --label <name> --apk <files repo>/test/mindgarden-v<N>-debug.apk --quick --force`
  (copied from kognius_app and updated 22.11.2026 for the language row and the version label in the hero card; 27 of 27 on v14 debug, the 28th test exists only with --keep; a practice
  round is always 10 questions). It installs the APK and clears its data unless `--keep`.
- Use your own port and pass `-s <serial>` to every adb command; DevTools pages are picked by package. Never attach to
  another job's emulator or WebView.
- Proofs need the debug variant (`test/mindgarden-v<N>-debug.apk`) for DevTools; the release is checked by screenshots,
  uiautomator and `dumpsys`.

## Play Protect (what was seen, 22.11.2026, emulator Pixel_7_API_35 with Google Play)

v12 (`mindgarden-share-v12.apk`, targetSdk 34, REQUEST_INSTALL_PACKAGES) was blocked on a fresh install: "Google Play Protect.
Harmful app blocked. This app may be harmful." with "Install anyway" hidden under More details, the same as on Emina's phone.
v13 (targetSdk 35, INTERNET only) installed over v12 with no dialog. That is one emulator at one moment, not a promise for a
real phone: Play Protect's verdicts come from Google's servers and can change. Nothing outside the Play Store removes the
warning for sure.

## Next

- Marko installs v14 on his own phone (steps above) and reports what Play Protect showed.
- The next build only when a web release changes something the app shows, or the shell changes (rule above).
- A progress export, before any change of the signing key (Marko's decision for later; the key stays as it is).
