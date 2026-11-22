#!/usr/bin/env python3
"""The upload signing, tested against a local stand-in of the site's route before anything real is uploaded.
The stand-in re-implements the checks of the web repo's lib/app.js with its own code (5-minute window in milliseconds,
HMAC over the key TEXT, version, chunk size, finish over the stored chunks), so a signing mistake turns the build red
here, not at the site. Random key, random file, 127.0.0.1 only.
    python3 scripts/test_upload.py"""
import hashlib, hmac, json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import upload_apk  # noqa: E402

KEY = os.urandom(32).hex()
STORE = {'live': 0, 'chunks': {}, 'files': {}}
MAXC = 1048576


class StandIn(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def answer(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path.split('?')[0] == '/app/version.json':
            return self.answer(200, {'version': STORE['live']})
        self.answer(404, {})

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if 'urllib' in (self.headers.get('User-Agent') or '').lower():
            return self.answer(403, {'error': 'user agent'})            # what Cloudflare does
        ts = self.headers.get('X-MG-Timestamp', '')
        sig = self.headers.get('X-MG-Signature', '')
        if not ts.isdigit() or abs(time.time() * 1000 - int(ts)) > 5 * 60 * 1000:
            return self.answer(401, {'error': 'time'})
        msg = f'POST\n{self.path}\n{ts}\n{hashlib.sha256(body).hexdigest()}'.encode()
        if not hmac.compare_digest(hmac.new(KEY.encode(), msg, hashlib.sha256).hexdigest(), sig):
            return self.answer(401, {'error': 'signature'})
        m = re.fullmatch(r'/app/upload/([1-9][0-9]{0,5})/(0|[1-9][0-9]{0,2}|finish)', self.path)
        if not m:
            return self.answer(404, {})
        v = int(m.group(1))
        if v <= STORE['live']:
            return self.answer(409, {'error': 'version'})
        if m.group(2) != 'finish':
            if len(body) < 1 or len(body) > MAXC:
                return self.answer(413, {'error': 'size'})
            STORE['chunks'].setdefault(v, {})[int(m.group(2))] = body
            return self.answer(200, {'ok': True})
        f = json.loads(body)
        if set(f) != {'chunks', 'size', 'sha256', 'date', 'web_commit'}:
            return self.answer(400, {'error': 'fields'})
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', f['date']) or not re.fullmatch(r'[0-9a-f]{7,40}', f['web_commit']):
            return self.answer(400, {'error': 'bad fields'})
        parts = STORE['chunks'].get(v, {})
        if sorted(parts) != list(range(f['chunks'])):
            return self.answer(422, {'error': 'chunks'})
        whole = b''.join(parts[i] for i in sorted(parts))
        if len(whole) != f['size'] or hashlib.sha256(whole).hexdigest() != f['sha256']:
            return self.answer(422, {'error': 'sha256'})
        STORE['files'][v] = whole; STORE['live'] = v
        self.answer(200, {'ok': True})


# The web worker's recipe (tools/app_sign.py, signed_post), copied here word for word, as the second opinion
def web_recipe_sig(key, path, ts, body):
    return hmac.new(key.encode(), f'POST\n{path}\n{ts}\n{hashlib.sha256(body).hexdigest()}'.encode(), hashlib.sha256).hexdigest()


def main():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), StandIn)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    site = f'http://127.0.0.1:{srv.server_address[1]}'
    fails = []

    def expect(name, ok):
        print(('ok    ' if ok else 'FAIL  ') + name)
        if not ok:
            fails.append(name)

    data = os.urandom(2 * MAXC + 12345)
    meta = {'version': 14, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'date': '2026-11-22',
            'web_commit': 'a' * 40, 'file': 'apk/mindgarden-v14.apk'}
    n = upload_apk.upload(site, data, meta, KEY)
    expect('a 3-chunk upload is accepted and stored byte for byte', n == 3 and STORE['files'].get(14) == data and STORE['live'] == 14)

    s, _ = upload_apk.post(site, '/app/upload/15/0', b'x', os.urandom(32).hex(), 'application/octet-stream')
    expect('a wrong key is refused (401)', s == 401)
    s, _ = upload_apk.post(site, '/app/upload/15/0', b'x', KEY, 'application/octet-stream', now=lambda: time.time() - 400)
    expect('a timestamp older than 5 minutes is refused (401)', s == 401)
    s, _ = upload_apk.post(site, '/app/upload/14/0', b'x', KEY, 'application/octet-stream')
    expect('a version not higher than the live one is refused (409)', s == 409)
    s, _ = upload_apk.post(site, '/app/upload/15/0', b'x' * (MAXC + 1), KEY, 'application/octet-stream')
    expect('a chunk over 1 MiB is refused (413)', s == 413)
    upload_apk.post(site, '/app/upload/15/0', b'abc', KEY, 'application/octet-stream')
    bad = {'chunks': 1, 'size': 3, 'sha256': hashlib.sha256(b'abd').hexdigest(), 'date': '2026-11-22', 'web_commit': 'a' * 40}
    s, _ = upload_apk.post(site, '/app/upload/15/finish', json.dumps(bad).encode(), KEY, 'application/octet-stream')
    expect('a finish whose sha256 does not match the chunks is refused (422) and v14 stays live', s == 422 and STORE['live'] == 14)
    try:
        upload_apk.upload(site, data, meta, KEY)
        expect('the client stops by itself when the version is not higher', False)
    except SystemExit as e:
        expect('the client stops by itself when the version is not higher', 'not higher' in str(e))
    k, p, t, b = '0123456789abcdef' * 4, '/app/upload/14/0', '1763800000000', b'hello'
    mine = upload_apk.sign(k, p, t, b)
    expect('the same bytes as the web recipe (tools/app_sign.py)', mine == web_recipe_sig(k, p, t, b))
    expect('known answer computed with openssl', mine == KNOWN)
    expect('a real User-Agent is sent', 'urllib' not in upload_apk.UA.lower())
    srv.shutdown()
    total = 10
    print(f'upload rule: {total - len(fails)} of {total} checks pass')
    sys.exit(1 if fails else 0)


# printf 'POST\n/app/upload/14/0\n1763800000000\n<sha256hex of "hello">' | openssl dgst -sha256 -mac HMAC -macopt key:0123456789abcdef x4
KNOWN = '29d7eb2262d95603dc5746da664b18b46e5637da130f267d74982f2ec33e247f'

if __name__ == '__main__':
    main()
