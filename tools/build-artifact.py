#!/usr/bin/env python3
"""Strip index.html down to the body-content form the Artifact tool expects.

The Artifact publisher wraps the file it is given in its own
<!doctype>/<head>/<body> skeleton (supplying charset and viewport), so the
document wrapper has to come off. Everything else -- title, font link,
styles, markup, script -- passes through untouched.

    python3 tools/build-artifact.py [out.html]
"""
import re, sys, pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / "index.html"
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path("dist/artifact.html")

DROP = re.compile(
    r"""^\s*(?:<!doctype\s+html>
         |</?html\b[^>]*>
         |</?head>
         |</?body>
         |<meta\s+charset=
         |<meta\s+name="viewport")""",
    re.I | re.X,
)

lines = SRC.read_text(encoding="utf-8").splitlines()
kept = [ln for ln in lines if not DROP.match(ln)]
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(kept).strip() + "\n", encoding="utf-8")
print(f"{OUT}: {len(kept)} lines ({len(lines) - len(kept)} wrapper lines removed)")
