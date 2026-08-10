#!/usr/bin/env python3
"""Stage the Cloudflare Functions so a browser can run them against a fake KV.

There's no Node on this machine, so `wrangler` can't run the Functions locally.
This copies functions/ into public/_cfcheck/ with one change — the `clash.json`
import becomes a JS module, which a browser can actually load — then you open
the site and run the suite from the console:

    python3 tests/mirror.py
    # start the server, then in the browser console:
    #   import('/_cfcheck/run.js').then(m => m.run()).then(console.table)
    python3 tests/mirror.py --clean
"""

import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "functions")
DST = os.path.join(ROOT, "public", "_cfcheck")

if "--clean" in sys.argv:
    shutil.rmtree(DST, ignore_errors=True)
    print("removed", os.path.relpath(DST, ROOT))
    raise SystemExit

shutil.rmtree(DST, ignore_errors=True)

for root, _, files in os.walk(SRC):
    for f in files:
        if not f.endswith(".js"):
            continue
        rel = os.path.relpath(os.path.join(root, f), SRC)
        dst = os.path.join(DST, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        code = open(os.path.join(root, f), encoding="utf-8").read()
        code = code.replace('import config from "../clash.json";',
                            'import config from "./config.js";')
        open(dst, "w", encoding="utf-8").write(code)

cfg = json.load(open(os.path.join(ROOT, "clash.json"), encoding="utf-8"))
cfg.pop("_notes", None)
open(os.path.join(DST, "config.js"), "w", encoding="utf-8").write(
    "export default " + json.dumps(cfg, indent=2) + ";\n")

shutil.copy(os.path.join(ROOT, "tests", "run.js"), os.path.join(DST, "run.js"))

print("staged -> public/_cfcheck/  (run tests/mirror.py --clean when done)")
