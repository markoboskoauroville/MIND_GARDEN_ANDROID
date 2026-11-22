#!/usr/bin/env python3
"""The shell's own rules, checked before every build (MANTRA_MANIFEST no-downgrades.md §4: what v12 did is pinned here,
so a rewrite that drops it turns the build red instead of reaching a phone).
    python3 scripts/check_rules.py"""
import os, re, subprocess, sys

R = os.path.join(os.path.dirname(__file__), '..')
src = lambda p: open(os.path.join(R, p), encoding='utf-8').read()
main = src('app/src/main/java/app/mindgarden/MainActivity.java')
man = src('app/src/main/AndroidManifest.xml')
gradle = src('app/build.gradle')
tts = src('app/src/main/java/app/mindgarden/Tts.java')

RULES = [
    # v12 features that must stay (no downgrades)
    ('same app id as v1..v12 (installs over them)', "applicationId 'app.mindgarden'" in gradle),
    ('same page address as v12 (players and progress in localStorage survive)', 'START = "file:///android_asset/www/index.html"' in main),
    ('localStorage on', 'setDomStorageEnabled(true)' in main),
    ('native back button steps back inside the game (window.appBack)', 'onBackPressed' in main and 'window.appBack' in main),
    ('confirm() works (WebChromeClient onJsConfirm, the v12 fix)', 'onJsConfirm' in main and 'r.confirm()' in main and 'r.cancel()' in main),
    ('alert() works', 'onJsAlert' in main),
    ("the phone's voice for 'Welcome, name' (MGTts)", '"MGTts"' in main and 'TextToSpeech' in tts),
    ('TTS engine visible on Android 11+', 'android.intent.action.TTS_SERVICE' in man),
    ('sound plays without a tap first', 'setMediaPlaybackRequiresUserGesture(false)' in main),
    ('the on-device test runner can read the page (WebView debugging, as v12)', 'setWebContentsDebuggingEnabled(true)' in main),
    ('portrait', 'android:screenOrientation="portrait"' in man),
    ('the screen stays on while playing', 'FLAG_KEEP_SCREEN_ON' in main),
    # the new rules
    ('MGUpdate kept for the game update box, MGApp for the website', '"MGUpdate"' in main and '"MGApp"' in main),
    ('only the game files load (no remote script beside the bridges)', 'shouldInterceptRequest' in main and 'SiteUrl.isBundled' in main),
    ('openWeb takes only a path: the site is fixed natively', 'SiteUrl.forPath(BuildConfig.SITE, path)' in src('app/src/main/java/app/mindgarden/AppBridge.java')),
    ('no REQUEST_INSTALL_PACKAGES (the app never installs anything)', 'REQUEST_INSTALL_PACKAGES' not in man and 'PackageInstaller' not in main),
    ('only the INTERNET permission', re.findall(r'uses-permission android:name="([^"]+)"', man) == ['android.permission.INTERNET']),
    ('targetSdk 35', 'targetSdk 35' in gradle),
    ('margins: bars + cutout + 16 dp on four sides', 'WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()' in main and '16 *' in main),
    ('no keystore path or other key in the build file', 'keystore/' not in gradle and 'MG_KEYSTORE' in gradle),
]

# nothing of the game, no key, no binary is ever committed in this public repository
tracked = subprocess.run(['git', '-C', R, 'ls-files'], capture_output=True, text=True).stdout.split()
banned = [f for f in tracked if f.startswith('app/src/main/assets/') or re.search(r'\.(apk|keystore|jks|mp3|webp|pem|key)$', f)]
RULES.append(('no game content, audio, APK or key tracked in this repo', not banned))

bad = [n for n, ok in RULES if not ok]
for n, ok in RULES:
    print(('ok    ' if ok else 'FAIL  ') + n)
for b in banned:
    print('      tracked but forbidden: ' + b)
print(f'rules: {len(RULES) - len(bad)} of {len(RULES)}')
sys.exit(1 if bad else 0)
