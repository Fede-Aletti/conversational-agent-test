"""Tiny SVG toolkit that applies the "diagram-design" visual grammar (editorial, flat, orthogonal connectors).

Style inspired by cathrynlavery/diagram-design (MIT): paper/ink palette, one accent for focal elements,
hairline borders, no shadows, orthogonal arrows with masked labels. Fonts fall back to system stacks so the
SVGs render the same offline and on GitHub.
"""

from __future__ import annotations

from html import escape

from i18n import get_lang, tr

PAPER = "#f5f5f5"
PAPER2 = "#ececec"
INK = "#2d3142"
MUTED = "#4f5d75"
SOFT = "#5a6580"
RULE = "#bfc0c0"
ACCENT = "#bf4520"
TINT = "rgba(191,69,32,0.08)"
LINK = "#2e5aa8"

SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif"
SANS = "Geist, -apple-system, 'Helvetica Neue', Arial, sans-serif"
MONO = "'Geist Mono', ui-monospace, Menlo, Consolas, monospace"

COLORS = {"ink": INK, "muted": MUTED, "accent": ACCENT, "link": LINK, "rule": RULE, "soft": SOFT}


def esc(s: str) -> str:
    return escape(s, quote=True)


def defs() -> str:
    marks = "".join(
        f'<marker id="a-{name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
        f'orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9 z" fill="{col}"/></marker>'
        for name, col in COLORS.items()
    )
    return f"<defs>{marks}</defs>"


def text(x, y, s, size=12, weight=400, fill=INK, family=SANS, anchor="start", ls=None, italic=False, opacity=None) -> str:
    extra = ""
    if ls:
        extra += f' letter-spacing="{ls}"'
    if italic:
        extra += ' font-style="italic"'
    if opacity is not None:
        extra += f' opacity="{opacity}"'
    s = tr(s)
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}"{extra}>{esc(s)}</text>'
    )


def eyebrow(x, y, s, fill=SOFT, anchor="start") -> str:
    return text(x, y, tr(s).upper(), size=8, weight=500, fill=fill, family=MONO, anchor=anchor, ls="1.4")


def mono(x, y, s, size=9, fill=MUTED, anchor="start", weight=400) -> str:
    return text(x, y, s, size=size, fill=fill, family=MONO, anchor=anchor, weight=weight, ls="0.3")


def label(x, y, s, size=9, fill=MUTED, anchor="middle", mask=True, weight=400) -> str:
    """Mono arrow label with a paper mask so it never touches a stroke."""
    s = tr(s)
    w = len(s) * size * 0.62 + 10
    if anchor == "middle":
        rx = x - w / 2
    elif anchor == "end":
        rx = x - w + 5
    else:
        rx = x - 5
    rect = (
        f'<rect x="{rx:.1f}" y="{y - size - 1:.1f}" width="{w:.1f}" height="{size + 5:.1f}" fill="{PAPER}"/>'
        if mask
        else ""
    )
    return rect + mono(x, y, s, size=size, fill=fill, anchor=anchor, weight=weight)


def box(x, y, w, h, name, sub=None, kind="default", sub2=None, name_size=12, sub_size=8.5) -> str:
    fill, stroke, sw, dash, name_fill, sub_fill = PAPER, INK, 1, "", INK, SOFT
    if kind == "focal":
        fill, stroke, sw = TINT, ACCENT, 1.6
    elif kind == "store":
        fill, stroke = PAPER2, MUTED
    elif kind == "external":
        stroke = LINK
    elif kind == "boundary":
        dash = ' stroke-dasharray="4 3"'
        stroke = MUTED
    elif kind == "optional":
        dash = ' stroke-dasharray="2 3"'
        stroke = MUTED
    elif kind == "quiet":
        stroke = RULE
        name_fill = MUTED
    parts = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>']
    cx = x + w / 2
    if sub is None:
        parts.append(text(cx, y + h / 2 + 4, name, size=name_size, weight=600, fill=name_fill, anchor="middle"))
    elif sub2 is None:
        parts.append(text(cx, y + h / 2 - 2, name, size=name_size, weight=600, fill=name_fill, anchor="middle"))
        parts.append(mono(cx, y + h / 2 + 12, sub, size=sub_size, fill=sub_fill, anchor="middle"))
    else:
        parts.append(text(cx, y + h / 2 - 8, name, size=name_size, weight=600, fill=name_fill, anchor="middle"))
        parts.append(mono(cx, y + h / 2 + 5, sub, size=sub_size, fill=sub_fill, anchor="middle"))
        parts.append(mono(cx, y + h / 2 + 17, sub2, size=sub_size, fill=sub_fill, anchor="middle"))
    return "".join(parts)


def container(x, y, w, h, title, dashed=True) -> str:
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{PAPER2}" fill-opacity="0.55" '
        f'stroke="{RULE}" stroke-width="1"{dash}/>' + eyebrow(x + 14, y + 20, title)
    )


def arrow(points, color="muted", width=1.3, dashed=False, both=False, head=True) -> str:
    d = "M" + " L".join(f"{x} {y}" for x, y in points)
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    ms = f' marker-start="url(#a-{color})"' if both else ""
    me = f' marker-end="url(#a-{color})"' if head else ""
    return (
        f'<path d="{d}" fill="none" stroke="{COLORS[color]}" stroke-width="{width}" '
        f'stroke-linejoin="round"{dash}{ms}{me}/>'
    )


def svg_doc(width, height, body, title, desc) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
        f'role="img" aria-labelledby="t d"><title id="t">{esc(tr(title))}</title><desc id="d">{esc(tr(desc))}</desc>'
        f'{defs()}<rect width="{width}" height="{height}" fill="{PAPER}"/>{body}</svg>'
    )


def title_block(x, y, eyebrow_text, title, subtitle=None) -> str:
    out = eyebrow(x, y, eyebrow_text, fill=ACCENT) + text(x, y + 34, title, size=30, family=SERIF)
    if subtitle:
        out += text(x, y + 56, subtitle, size=12, fill=MUTED)
    return out


def html_page(svg: str, title: str) -> str:
    return (
        f'<!doctype html><html lang="{get_lang()}"><head><meta charset="utf-8"><title>{esc(title)}</title>'
        f"<style>html,body{{margin:0;background:{PAPER};}}svg{{display:block;margin:0 auto;max-width:100%;height:auto}}</style>"
        f"</head><body>{svg}</body></html>"
    )
