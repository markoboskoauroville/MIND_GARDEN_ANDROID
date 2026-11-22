#!/usr/bin/env python3
"""The upload signing, tested against a local stand-in of the site's route before anything real is uploaded.
The stand-in checks the rule of upload_apk.py with its own code (time window, HMAC, version, chunk size, finish),
so a signing mistake turns the build red here. Random key, random file, 127.0.0.1 only.
    python3 scripts/test_upload.py"""
import hashlib, hmac, json, os, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(__file__))
import upload_apk  # noqa: E402

KEY = os.urandom(32)
STORE = {'served': 12, 'chunks': {}, 'files': {}}
MAXC = 1048576


class StandIn(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def answer(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path == '/app/version.json':
            return self.answer(200, {'version': STORE['served'], 'date': '2026-11-22'})
        self.answer(404, {})

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        ts = self.headers.get('X-MG-Time', '')
        sig = self.headers.get('X-MG-Sig', '')
        if not ts.isdigit() or abs(time.time() - int(ts)) > 300:
            return self.answer(401, {'error': 'time'})
        msg = ('POST\n' + self.path + '\n' + ts + '\n' + hashlib.sha256(body).hexdigest()).encode()
        if not hmac.compare_digest(hmac.new(KEY, msg, hashlib.sha256).hexdigest(), sig):
            return self.answer(401, {'error': 'signature'})
        m = re.fullmatch(r'/app/upload/(\d+)/(\d+|finish)', self.path)
        if not m:
            return self.answer(404, {})
        v = int(m.group(1))
        if v <= STORE['served']:
            return self.answer(409, {'error': 'version'})
        if m.group(2) != 'finish':
            if len(body) > MAXC:
                return self.answer(413, {'error': 'size'})
            STORE['chunks'].setdefault(v, {})[int(m.group(2))] = body
            return self.answer(200, {'ok': True})
        meta = json.loads(body)
        parts = STORE['chunks'].get(v, {})
        if sorted(parts) != list(range(meta.get('chunks', -1))):
            return self.answer(422, {'error': 'chunks'})
        whole = b''.join(parts[i] for i in sorted(parts))
        if len(whole) != meta['size'] or hashlib.sha256(whole).hexdigest() != meta['sha256']:
            return self.answer(422, {'error': 'sha256'})
        STORE['files'][v] = whole; STORE['served'] = v
        self.answer(200, {'ok': True})


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
    meta = {'version': 13, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'date': '2026-11-22',
            'web_commit': '0' * 40, 'file': 'apk/mindgarden-v13.apk'}
    n = upload_apk.upload(site, data, meta, KEY)
    expect('a 3-chunk upload is accepted and stored byte for byte', n == 3 and STORE['files'].get(13) == data and STORE['served'] == 13)

    s, _ = upload_apk.post(site, '/app/upload/14/0', b'x', os.urandom(32), 'application/octet-stream')
    expect('a wrong key is refused (401)', s == 401)
    s, _ = upload_apk.post(site, '/app/upload/14/0', b'x', KEY, 'application/octet-stream', now=lambda: time.time() - 400)
    expect('a signature older than 5 minutes is refused (401)', s == 401)
    s, _ = upload_apk.post(site, '/app/upload/13/0', b'x', KEY, 'application/octet-stream')
    expect('a version not higher than the served one is refused (409)', s == 409)
    s, _ = upload_apk.post(site, '/app/upload/14/0', b'x' * (MAXC + 1), KEY, 'application/octet-stream')
    expect('a chunk over 1 MiB is refused (413)', s == 413)
    upload_apk.post(site, '/app/upload/14/0', b'abc', KEY, 'application/octet-stream')
    bad = dict(meta, version=14, size=3, sha256=hashlib.sha256(b'abd').hexdigest(), chunks=1)
    s, _ = upload_apk.post(site, '/app/upload/14/finish', json.dumps(bad).encode(), KEY, 'application/json')
    expect('a finish whose sha256 does not match the chunks is refused (422) and v13 stays served', s == 422 and STORE['served'] == 13)
    try:
        upload_apk.upload(site, data, meta, KEY)
        expect('the client stops by itself when the version is not higher', False)
    except SystemExit as e:
        expect('the client stops by itself when the version is not higher', 'not higher' in str(e))
    sig = upload_apk.sign(bytes(range(32)), '/app/upload/13/0', 1763800000, b'hello')
    expect('known-answer signature (shared with the web worker)', sig == KNOWN)
    srv.shutdown()
    print(f'upload rule: {8 - len(fails)} of 8 checks pass')
    sys.exit(1 if fails else 0)


# HMAC-SHA256(key = bytes 0x00..0x1f, "POST\n/app/upload/13/0\n1763800000\n" + sha256hex("hello"))
KNOWN = '2d8f29ad8f117b5a524705c79b42bbf602ef505397931a5cc250d0cba38443e6'   # computed with openssl, not with this code

if __name__ == '__main__':
    main()
