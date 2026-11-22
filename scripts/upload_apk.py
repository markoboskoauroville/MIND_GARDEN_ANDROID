#!/usr/bin/env python3
"""Upload the APK to the site's private store, in signed chunks. The key can do nothing but this.

THE RULE (the site checks exactly this; agreed 22.11.2026, written the same in the web repo):
  key        APP_UPLOAD_KEY = 64 lowercase hex characters; the HMAC key is the 32 bytes they encode.
  chunks     POST <site>/app/upload/<version>/<index>   index 0, 1, 2 ...  body = raw APK bytes, at most 1,048,576
             Content-Type: application/octet-stream
  finish     POST <site>/app/upload/<version>/finish    body = JSON: the app.json fields plus "chunks": <count>
             Content-Type: application/json
  headers    X-MG-Time: unix seconds (integer)
             X-MG-Sig:  lowercase hex HMAC-SHA256(key, "POST\\n" + path + "\\n" + time + "\\n" + sha256hex(body))
             path = the URL path only, e.g. /app/upload/13/0 (no host, no query)
  the site   401 when the time is more than 300 s away or the signature is wrong (constant-time compare);
             409 when the version is not higher than the one served; 413 when a chunk is over 1,048,576 bytes;
             422 when finish's size, sha256 or chunk count do not match the stored chunks; 200 {"ok": true} otherwise.
             Only a good finish makes the new version the one served, in one step.
Before uploading, the public GET <site>/app/version.json is read: a version not higher than the served one stops here.
    APP_UPLOAD_KEY=... python3 scripts/upload_apk.py <site> <apk> <app.json>"""
import hashlib, hmac, json, os, sys, time, urllib.error, urllib.request

CHUNK = 1024 * 1024


def sign(key, path, ts, body):
    msg = 'POST\n' + path + '\n' + str(ts) + '\n' + hashlib.sha256(body).hexdigest()
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).hexdigest()


def post(site, path, body, key, ctype, now=time.time):
    ts = int(now())
    req = urllib.request.Request(site.rstrip('/') + path, data=body, method='POST', headers={
        'Content-Type': ctype, 'X-MG-Time': str(ts), 'X-MG-Sig': sign(key, path, ts, body),
        'User-Agent': 'mindgarden-android-ci'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def served_version(site):
    try:
        with urllib.request.urlopen(site.rstrip('/') + '/app/version.json', timeout=30) as r:
            return int(json.load(r).get('version') or 0)
    except urllib.error.HTTPError as e:
        raise SystemExit(f'::error::GET /app/version.json answered {e.code}: is the upload route live?')


def upload(site, apk_bytes, meta, key, now=time.time, check_served=True):
    v = int(meta['version'])
    if check_served:
        cur = served_version(site)
        if v <= cur:
            raise SystemExit(f'::error::v{v} is not higher than the served v{cur}: nothing uploaded (never backwards)')
    parts = [apk_bytes[i:i + CHUNK] for i in range(0, len(apk_bytes), CHUNK)]
    for i, part in enumerate(parts):
        for attempt in range(3):
            s, b = post(site, f'/app/upload/{v}/{i}', part, key, 'application/octet-stream', now)
            if s == 200:
                break
            if s in (401, 409, 413, 422) or attempt == 2:
                raise SystemExit(f'::error::chunk {i} refused: HTTP {s} {b[:200]!r}')
            time.sleep(3)
    fin = dict(meta); fin['chunks'] = len(parts)
    s, b = post(site, f'/app/upload/{v}/finish', json.dumps(fin).encode('utf-8'), key, 'application/json', now)
    if s != 200:
        raise SystemExit(f'::error::finish refused: HTTP {s} {b[:200]!r}')
    return len(parts)


def key_from_env():
    k = os.environ.get('APP_UPLOAD_KEY', '').strip()
    if len(k) != 64 or any(c not in '0123456789abcdef' for c in k):
        raise SystemExit('::error::secret APP_UPLOAD_KEY is missing or not 64 lowercase hex characters')
    return bytes.fromhex(k)


if __name__ == '__main__':
    site, apk, meta_path = sys.argv[1:4]
    data = open(apk, 'rb').read()
    meta = json.load(open(meta_path))
    if meta['size'] != len(data) or meta['sha256'] != hashlib.sha256(data).hexdigest():
        raise SystemExit('::error::app.json does not describe this APK')
    n = upload(site, data, meta, key_from_env())
    print(f"uploaded v{meta['version']}: {len(data)} bytes in {n} chunks")
