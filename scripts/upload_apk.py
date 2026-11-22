#!/usr/bin/env python3
"""Upload the APK to the site's private store, in signed chunks. The key can do nothing but this.

THE RULE (the site's lib/app.js and tools/app_sign.py of MIND_GARDEN_WEB; this file sends exactly the same bytes):
  key        APP_UPLOAD_KEY, a text of 64 hex characters; the HMAC key is that TEXT (its UTF-8 bytes), not decoded.
  chunks     POST <site>/app/upload/<version>/<index>   index 0, 1, 2 ...  body = raw APK bytes, at most 1,048,576
  finish     POST <site>/app/upload/<version>/finish    body = JSON {"chunks","size","sha256","date","web_commit"}
  headers    X-MG-Timestamp: milliseconds since 1970
             X-MG-Signature: hex HMAC-SHA256(key, "POST\\n" + path + "\\n" + timestamp + "\\n" + hex sha256(body))
             path = the URL path only, e.g. /app/upload/14/0
             User-Agent: a real name (Cloudflare refuses python-urllib's default with 403)
  the site   refuses a timestamp more than 5 minutes away or a bad signature, a version not higher than the live one
             (409), a chunk over 1 MiB (413), a finish whose count, size or sha256 do not match the stored chunks (422);
             503 while its key is not set. Only a good finish makes the new version live, in one step.
Before uploading, the public GET <site>/app/version.json is read: a version not higher than the live one stops here.
    APP_UPLOAD_KEY=... python3 scripts/upload_apk.py <site> <apk> <app.json>"""
import hashlib, hmac, json, os, sys, time, urllib.error, urllib.request

CHUNK = 1048576
UA = 'MindGardenAndroidCI/1 (+github.com/markoboskoauroville/MIND_GARDEN_ANDROID)'


def sign(key, path, ts, body):
    msg = 'POST\n' + path + '\n' + str(ts) + '\n' + hashlib.sha256(body).hexdigest()
    return hmac.new(key.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).hexdigest()


def post(site, path, body, key, ctype, now=time.time):
    ts = str(int(now() * 1000))
    req = urllib.request.Request(site.rstrip('/') + path, data=body, method='POST', headers={
        'Content-Type': ctype, 'X-MG-Timestamp': ts, 'X-MG-Signature': sign(key, path, ts, body), 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def served_version(site):
    req = urllib.request.Request(site.rstrip('/') + '/app/version.json', headers={'User-Agent': UA, 'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return int(json.load(r).get('version') or 0)
    except urllib.error.HTTPError as e:
        raise SystemExit(f'::error::GET /app/version.json answered {e.code}')


def upload(site, apk_bytes, meta, key, now=time.time, check_served=True):
    v = int(meta['version'])
    if check_served:
        cur = served_version(site)
        if v == cur:
            print(f'v{v} is already the live version: nothing to upload')
            return 0
        if v < cur:
            raise SystemExit(f'::error::v{v} is lower than the live v{cur}: nothing uploaded (never backwards)')
    parts = [apk_bytes[i:i + CHUNK] for i in range(0, len(apk_bytes), CHUNK)]
    for i, part in enumerate(parts):
        for attempt in range(3):
            s, b = post(site, f'/app/upload/{v}/{i}', part, key, 'application/octet-stream', now)
            if s == 200:
                break
            if s in (400, 401, 403, 409, 413, 422, 503) or attempt == 2:
                raise SystemExit(f'::error::chunk {i} refused: HTTP {s} {b[:200]!r}')
            time.sleep(3)
    fin = {'chunks': len(parts), 'size': len(apk_bytes), 'sha256': hashlib.sha256(apk_bytes).hexdigest(),
           'date': meta['date'], 'web_commit': meta['web_commit']}
    s, b = post(site, f'/app/upload/{v}/finish', json.dumps(fin).encode('utf-8'), key, 'application/octet-stream', now)
    if s != 200:
        raise SystemExit(f'::error::finish refused: HTTP {s} {b[:200]!r}')
    return len(parts)


def key_from_env():
    k = os.environ.get('APP_UPLOAD_KEY', '').strip()
    if len(k) < 16:
        raise SystemExit('::error::secret APP_UPLOAD_KEY is missing')
    return k


if __name__ == '__main__':
    site, apk, meta_path = sys.argv[1:4]
    data = open(apk, 'rb').read()
    meta = json.load(open(meta_path))
    if meta['size'] != len(data) or meta['sha256'] != hashlib.sha256(data).hexdigest():
        raise SystemExit('::error::app.json does not describe this APK')
    n = upload(site, data, meta, key_from_env())
    print(f"uploaded v{meta['version']}: {len(data)} bytes in {n} chunks")
