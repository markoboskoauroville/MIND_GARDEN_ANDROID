#!/usr/bin/env python3
"""The fingerprint of a game folder: sha256 over every file's relative path and content hash, sorted, without the
top-level mode.js (the one file the app writes itself). Same folder, same hash, on any machine.
    python3 scripts/www_hash.py <folder>"""
import hashlib, os, sys


def www_hash(root):
    lines = []
    for d, _, files in os.walk(root):
        for f in files:
            p = os.path.join(d, f)
            rel = os.path.relpath(p, root).replace(os.sep, '/')
            if rel == 'mode.js':
                continue
            with open(p, 'rb') as fh:
                lines.append(rel + '\0' + hashlib.sha256(fh.read()).hexdigest() + '\n')
    lines.sort()
    return hashlib.sha256(''.join(lines).encode('utf-8')).hexdigest(), len(lines)


if __name__ == '__main__':
    print(www_hash(sys.argv[1])[0])
