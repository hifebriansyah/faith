#!/usr/bin/env python3
"""Cache busting for the icons: put ?v=<hash of the file> on every icon address in index.html and manifest.webmanifest.

    python3 tools/stamp_icons.py            stamp the files in the repo (tools/make_icons.py does this after it draws the icons)
    python3 tools/stamp_icons.py _site      stamp a built copy: the Pages workflow runs this on every deploy

Browsers keep favicons for a very long time and ignore a reload; a new address makes them fetch the new picture. The hash is the
SHA-1 of the file's bytes, so it changes exactly when the picture changes, and running this twice gives the same result.
Standard library only (the deploy runner has no Pillow). Stops with an error when an icon the page mentions is missing.
"""
import hashlib
import re
import sys
from pathlib import Path

# an icon address inside quotes, with or without an old ?v=
ICON = re.compile(r"""(?<=["'])((?:logo\.svg|icons/[a-z0-9-]+\.png))(\?v=[0-9a-f]+)?(?=["'])""")
PAGES = ("index.html", "manifest.webmanifest")


def stamp(root: Path) -> None:
    def versioned(m: re.Match) -> str:
        return f"{m[1]}?v={hashlib.sha1((root / m[1]).read_bytes()).hexdigest()[:8]}"

    for page in PAGES:
        path = root / page
        path.write_text(ICON.sub(versioned, path.read_text(encoding="utf-8")), encoding="utf-8")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    stamp(target)
    print(f"icon addresses stamped in {target}")
