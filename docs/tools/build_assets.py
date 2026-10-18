"""Regenerate the README assets: SVG/HTML/PNG diagrams (and the demo GIF via build_demo.py).

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
from svgkit import html_page  # noqa: E402

ASSETS = HERE.parent / "assets"
SOURCE = ASSETS / "source"

DIAGRAMS = {
    "architecture": diagrams.architecture_svg,
    "fsm": diagrams.fsm_static_svg,
    "confirmation-sequence": diagrams.sequence_svg,
}


def main() -> None:
    SOURCE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(device_scale_factor=2)
        for name, fn in DIAGRAMS.items():
            svg = fn()
            (ASSETS / f"{name}.svg").write_text(svg, encoding="utf-8")
            html = html_page(svg, name)
            (SOURCE / f"{name}.html").write_text(html, encoding="utf-8")
            page.set_content(html)
            page.locator("svg").screenshot(path=str(ASSETS / f"{name}.png"))
            print("wrote", name)
        browser.close()
    import build_demo

    build_demo.main()


if __name__ == "__main__":
    main()
