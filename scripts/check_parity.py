#!/usr/bin/env python3
"""Parity: every feature the web repo lists for the app (mode "app" or "both" in tests/parity.json at the web commit)
must be in the built game folder: its file exists and contains the marker. No parity.json at that commit: said, not failed.
    python3 scripts/check_parity.py <web git dir> <commit> <www folder>"""
import json, os, subprocess, sys

web, commit, www = sys.argv[1:4]
try:
    raw = subprocess.run(['git', '-C', web, 'show', commit + ':tests/parity.json'], check=True,
                         capture_output=True).stdout
except subprocess.CalledProcessError:
    print('::notice::the web repo has no tests/parity.json at this commit: parity not checked')
    sys.exit(0)
features = json.loads(raw)['features']
bad, checked = [], 0
for f in features:
    if f.get('mode') not in ('app', 'both'):
        continue
    checked += 1
    path = os.path.join(www, f['file'])
    if not os.path.isfile(path):
        bad.append(f"{f['id']}: file {f['file']} is not in the app")
        continue
    with open(path, encoding='utf-8', errors='replace') as fh:
        if f['contains'] not in fh.read():
            bad.append(f"{f['id']}: {f['file']} does not contain {f['contains']!r}")
for b in bad:
    print('::error::parity: ' + b)
print(f'parity: {checked - len(bad)} of {checked} app features present')
sys.exit(1 if bad else 0)
