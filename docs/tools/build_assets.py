"""Regenerate the README assets (English and Spanish): SVG/HTML/PNG diagrams and the demo GIFs.

English keeps the plain names (architecture.svg, demo.gif); Spanish adds a `.es` suffix (architecture.es.svg,
demo.es.gif). Strings live in i18n.py. Pass `en` and/or `es` to build only those languages.

Usage (from the repo root):
    uv run --with playwright python docs/tools/build_assets.py
    # first time only: uv run --with playwright playwright install chromium
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from playwright.sync_api import sync_playwright  # noqa: E402

import diagrams  # noqa: E402
from i18n import LANGS, set_lang, suffix  # noqa: E402
from svgkit import html_page  # noqa: E402

ASSETS = HERE.parent / "assets"
SOURCE = ASSETS / "source"

DIAGRAMS = {
    "architecture": diagrams.architecture_svg,
    "fsm": diagrams.fsm_static_svg,
    "confirmation-sequence": diagrams.sequence_svg,
}


def main(langs=LANGS) -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(device_scale_factor=2)
        for lang in langs:
            set_lang(lang)
            for name, fn in DIAGRAMS.items():
                out = f"{name}{suffix()}"
                svg = fn()
                (ASSETS / f"{out}.svg").write_text(svg, encoding="utf-8")
                html = html_page(svg, name)
                (SOURCE / f"{out}.html").write_text(html, encoding="utf-8")
                page.set_content(html)
                page.locator("svg").screenshot(path=str(ASSETS / f"{out}.png"))
                print("wrote", out)
        browser.close()
    import build_demo

    for lang in langs:
        build_demo.main(lang)


if __name__ == "__main__":
    main(tuple(sys.argv[1:]) or LANGS)
