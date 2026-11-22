#!/usr/bin/env python3
"""The built APK, checked from the outside (nothing taken on trust from the build):
  - signed with the v11/v12 certificate (else it would not install over the phones' v12)
  - package app.mindgarden, versionCode = the version, targetSdk 35
  - permissions: INTERNET only (no REQUEST_INSTALL_PACKAGES)
  - assets/www inside the APK has the same hash as public/ of the web commit (git archive, extracted separately),
    and the APK's own www.sha256 and web_commit.txt say the same
  - assets/www/mode.js is the app's
    python3 scripts/check_apk.py <apk> <build-tools dir> <version> <cert sha256> <web git dir> <commit>"""
import os, re, subprocess, sys, tarfile, tempfile, zipfile, io

sys.path.insert(0, os.path.dirname(__file__))
from www_hash import www_hash  # noqa: E402

apk, bt, version, cert, web, commit = sys.argv[1:7]
errors = []


def run(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True).stdout


certs = run(os.path.join(bt, 'apksigner'), 'verify', '--print-certs', apk)
digests = re.findall(r'certificate SHA-256 digest: ([0-9a-f]{64})', certs)
if digests != [cert]:
    errors.append(f'certificate {digests} is not the v11/v12 one {cert}')

badging = run(os.path.join(bt, 'aapt2'), 'dump', 'badging', apk)
if f"name='app.mindgarden' versionCode='{version}' versionName='v{version}'" not in badging:
    errors.append('package/version line wrong: ' + badging.splitlines()[0])
if "targetSdkVersion:'35'" not in badging:
    errors.append('targetSdk is not 35')
if 'application-debuggable' in badging:
    errors.append('the release is debuggable: nothing on a player\'s computer may attach to it')
perms = sorted(set(re.findall(r"uses-permission: name='([^']+)'", badging)))
if perms != ['android.permission.INTERNET']:
    errors.append(f'permissions {perms}: only INTERNET is allowed')

with tempfile.TemporaryDirectory() as t:
    src, got = os.path.join(t, 'src'), os.path.join(t, 'apk')
    os.makedirs(src); os.makedirs(got)
    tar = subprocess.run(['git', '-C', web, 'archive', '--format=tar', commit, 'public'], check=True, capture_output=True).stdout
    with tarfile.open(fileobj=io.BytesIO(tar)) as tf:
        for m in tf.getmembers():
            if m.isfile() and m.name.startswith('public/'):
                m.name = m.name[len('public/'):]
                tf.extract(m, src)
    with zipfile.ZipFile(apk) as z:
        names = z.namelist()
        for n in names:
            if n.startswith('assets/www/') and not n.endswith('/'):
                z.extract(n, got)
        inner_hash = z.read('assets/www.sha256').decode().strip()
        inner_commit = z.read('assets/web_commit.txt').decode().strip()
        mode = z.read('assets/www/mode.js').decode()
    h_src, n_src = www_hash(src)
    h_apk, n_apk = www_hash(os.path.join(got, 'assets', 'www'))
    if h_src != h_apk:
        errors.append(f'drift: assets/www in the APK ({n_apk} files, {h_apk}) is not public/ of {commit} ({n_src} files, {h_src})')
    if inner_hash != h_src:
        errors.append(f'the APK says www.sha256 {inner_hash}, the web commit gives {h_src}')
    if inner_commit != commit:
        errors.append(f'the APK says web commit {inner_commit}, built from {commit}')
    if "name: 'app'" not in mode or 'bridge: true' not in mode:
        errors.append("assets/www/mode.js is not the app's")

for e in errors:
    print('::error::' + e)
if errors:
    sys.exit(1)
print(f'APK ok: v{version}, certificate {cert[:12]}..., permissions {perms}, {n_apk} game files, www.sha256 {h_apk}')
