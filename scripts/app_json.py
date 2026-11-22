#!/usr/bin/env python3
"""app.json for the site's store: {version, size, sha256, date, web_commit, file}.
    python3 scripts/app_json.py <apk> <version> <web commit>"""
import datetime, hashlib, json, os, sys

apk, version, commit = sys.argv[1], int(sys.argv[2]), sys.argv[3]
with open(apk, 'rb') as fh:
    data = fh.read()
print(json.dumps({
    'version': version,
    'size': len(data),
    'sha256': hashlib.sha256(data).hexdigest(),
    'date': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),
    'web_commit': commit,
    'file': f'apk/mindgarden-v{version}.apk',
}, indent=1))
