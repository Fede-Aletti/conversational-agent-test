"""Diagram builders for the Escala README (architecture, FSM, confirmation sequence)."""

from __future__ import annotations

from svgkit import *  # noqa: F401,F403

# --------------------------------------------------------------------------------------
# FSM (source of truth: escala/cxas_app/escala/agents/*/after_tool_callbacks/track_state/python_code.py::next_fsm)
# --------------------------------------------------------------------------------------

BW, BH = 124, 44
STATES = {
    "IDENTIFY": (40, 60, "ask PNR + surname"),
    "TRIAGE": (290, 60, "booking known"),
    "OPTIONS": (540, 60, "wait for the choice"),
    "FAQ": (290, 200, "answer with sources"),
    "CONFIRM": (540, 200, "confirmation recorded"),
    "DONE": (540, 370, "result + close"),
    "HANDOFF": (40, 370, "human case created"),
    "FAILURE": (290, 370, "apologize, offer human"),
}

# id -> (points, [(x, y, text, anchor)], color-when-static)
EDGES = {
    "start": ([(26, 82), (40, 82)], []),
    "ident_triage": ([(164, 82), (290, 82)], [(227, 74, "lookupBooking ok", "middle")]),
    "triage_options": (
        [(414, 82), (540, 82)],
        [(477, 72, "getRebookingOptions", "middle"), (477, 98, "ok · 1+ quotes", "middle")],
    ),
    "triage_faq": ([(352, 104), (352, 200)], [(360, 156, "searchFaq ok", "start")]),
    "opt_confirm": ([(602, 104), (602, 200)], [(594, 150, "record_quote_confirmation ok", "end")]),
    "confirm_done": ([(602, 244), (602, 370)], [(594, 310, "createRebooking ok", "end")]),
    "any_handoff": ([(227, 310), (102, 310), (102, 370)], [(110, 346, "createHandoffCase ok", "start")]),
    "any_failure": (
        [(227, 310), (352, 310), (352, 370)],
        [(360, 334, "no quotes returned", "start"), (360, 346, "blocking error code", "start"), (360, 358, "2 retryable errors", "start")],
    ),
}


def fsm_body(active=None, hot=None, visited=(), static=False) -> str:
    """FSM drawing in a 700x430 box. In replay mode `active` is highlighted and `hot` is the edge just taken."""
    out = []
    for eid, (pts, labels) in EDGES.items():
        if static:
            color, width, lab_fill = "muted", 1.3, MUTED
        elif eid == hot:
            color, width, lab_fill = "accent", 2.6, ACCENT
        elif eid in visited:
            color, width, lab_fill = "ink", 1.6, INK
        else:
            color, width, lab_fill = "rule", 1.2, "#8b93a5"
        out.append(arrow(pts, color=color, width=width))
        for x, y, s, anchor in labels:
            out.append(mono(x, y, s, size=9, fill=lab_fill, anchor=anchor, weight=600 if eid == hot else 400))
    out.append(f'<circle cx="20" cy="82" r="6" fill="{INK}"/>')
    out.append(f'<circle cx="227" cy="310" r="3.5" fill="{MUTED if static else "#8b93a5"}"/>')
    out.append(eyebrow(227, 298, "from any state", fill=SOFT, anchor="middle"))
    out.append(mono(20, 100, "start", size=8, fill=SOFT, anchor="middle"))
    for name, (x, y, sub) in STATES.items():
        if static:
            kind = {"DONE": "focal", "FAILURE": "boundary", "HANDOFF": "boundary"}.get(name, "default")
            out.append(box(x, y, BW, BH, name, sub, kind=kind, name_size=12.5))
            continue
        if name == active:
            out.append(box(x, y, BW, BH, name, sub, kind="focal", name_size=12.5))
        elif name in visited_states(visited):
            out.append(box(x, y, BW, BH, name, sub, kind="default", name_size=12.5))
        else:
            out.append(box(x, y, BW, BH, name, sub, kind="quiet", name_size=12.5))
    return "".join(out)


def visited_states(visited) -> set:
    edge_targets = {
        "start": "IDENTIFY", "ident_triage": "TRIAGE", "triage_options": "OPTIONS", "triage_faq": "FAQ",
        "opt_confirm": "CONFIRM", "confirm_done": "DONE", "any_handoff": "HANDOFF", "any_failure": "FAILURE",
    }
    return {edge_targets[e] for e in visited if e in edge_targets}


def fsm_replay_svg(active, hot, visited) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 430" width="700" height="430">{defs()}'
        f"{fsm_body(active, hot, visited)}</svg>"
    )


def fsm_static_svg() -> str:
    W, H = 760, 600
    body = title_block(30, 36, "State machine · track_state callback", "Conversation FSM", "Eight states, one pure transition function. The model never sets the state.")
    body += f'<g transform="translate(30,70)">{fsm_body(static=True)}</g>'
    body += text(30, 520, "next_fsm(state, failures, tool, result) runs in the after_tool callback of both agents. Each transition", size=14, family=SERIF, italic=True, fill=MUTED)
    body += text(30, 540, "publishes that state's step text as {fsm_instructions}, so the very next model call sees it.", size=14, family=SERIF, italic=True, fill=MUTED)
    body += mono(30, 570, "lookupBooking ok → TRIAGE from any state · unlisted (tool, state) pairs keep the current state · DONE is the focal outcome", size=8.5, fill=SOFT)
    return svg_doc(W, H, body, "Escala conversation state machine", "States IDENTIFY, TRIAGE, FAQ, OPTIONS, CONFIRM, DONE, HANDOFF and FAILURE with the tool results that trigger each transition.")


# --------------------------------------------------------------------------------------
# Architecture
# --------------------------------------------------------------------------------------


def architecture_svg() -> str:
    W, H = 1140, 790
    b = [title_block(30, 36, "Architecture · Escala prototype", "LLM understands and phrases, code decides", "Conversational layer on CX Agent Studio, deterministic backend on Firebase (simulated airline).")]

    # Passenger
    b.append(box(30, 160, 150, 64, "Passenger", "text chat · voice", kind="default"))
    b.append(arrow([(180, 192), (254, 192)], "ink", both=True))
    b.append(mono(219, 184, "message", size=8.5, fill=MUTED, anchor="middle"))

    # CES container
    b.append(container(240, 120, 420, 410, "CX Agent Studio · app escala · es-419"))
    b.append(box(258, 150, 168, 84, "root_agent", "greet · disclaimer", sub2="identify · FAQ · triage"))
    b.append(box(480, 150, 162, 84, "rebooking_agent", "disruption options", sub2="read-back · confirm"))
    b.append(arrow([(426, 192), (480, 192)], "ink"))
    b.append(label(453, 183, "transfer", size=8.5, mask=False))

    # callbacks band (guardrails)
    b.append(f'<rect x="258" y="262" width="384" height="128" rx="8" fill="{PAPER}" stroke="{MUTED}" stroke-width="1" stroke-dasharray="4 3"/>')
    b.append(eyebrow(272, 280, "Callbacks · guardrails written in code"))
    chips = [
        ("after_tool", "track_state", "FSM next_fsm() + fsm_instructions"),
        ("before_tool", "guard_mutating_calls", "blocks unconsented writes"),
        ("after_model", "inject_disclaimer", "experimental-prototype notice"),
    ]
    for i, (hook, name, what) in enumerate(chips):
        y = 290 + i * 31
        b.append(f'<rect x="270" y="{y}" width="360" height="26" rx="5" fill="{PAPER2}" stroke="{RULE}"/>')
        b.append(mono(280, y + 16.5, hook, size=8.5, fill=SOFT))
        b.append(text(344, y + 17, name, size=11, weight=600))
        b.append(mono(620, y + 16.5, what, size=8, fill=MUTED, anchor="end"))
    b.append(arrow([(340, 234), (340, 262)], "ink"))
    b.append(arrow([(561, 234), (561, 262)], "ink"))

    # tools row
    b.append(box(258, 424, 150, 84, "Python tools", "record_quote_confirmation", sub2="set_session_outcome", kind="default", sub_size=8))
    b.append(box(428, 424, 214, 84, "OpenAPI toolset", "escala_api_*  ·  6 operations", sub2="REST/JSON, lean schemas", kind="external", sub_size=8))
    b.append(arrow([(333, 390), (333, 424)], "ink"))
    b.append(arrow([(535, 390), (535, 424)], "link"))

    # Cloud function container
    b.append(container(760, 120, 350, 410, "Firebase Cloud Function · api"))
    b.append(arrow([(642, 466), (760, 466)], "link"))
    b.append(label(701, 457, "HTTPS + ID token", size=8.5, fill=LINK, mask=False))
    b.append(box(778, 150, 314, 44, "HTTP layer", "Express router · OpenAPI contract · validation", kind="default", sub_size=8))
    b.append(arrow([(935, 194), (935, 214)], "ink"))
    b.append(eyebrow(778, 226, "Bounded contexts · hexagonal", fill=SOFT))
    ctx = [
        (778, 238, "bookings", "lookup · identity", "default"),
        (938, 238, "operations", "status · alternatives", "default"),
        (778, 294, "rebooking", "quotes · createRebooking", "focal"),
        (938, 294, "ancillaries", "transfer outcomes", "default"),
        (778, 350, "policy-rules", "fees · FAQ rules", "default"),
        (938, 350, "handoff", "human cases", "default"),
    ]
    for x, y, n, s, k in ctx:
        b.append(box(x, y, 154, 46, n, s, kind=k, sub_size=8))
    b.append(box(778, 412, 314, 44, "shared kernel", "Clock · Result · idempotency ledger · UnitOfWork", kind="quiet", sub_size=8))
    b.append(box(778, 468, 314, 44, "ports → adapters", "domain has no Firebase imports", sub2="in-memory (tests)  |  Firestore (runtime)", kind="boundary", sub_size=8))

    # stores
    b.append(arrow([(870, 530), (870, 580)], "ink"))
    b.append(mono(878, 560, "Admin SDK · transactions", size=8.5, fill=MUTED))
    b.append(box(780, 580, 180, 62, "Firestore", "seeded flights, bookings", sub2="quotes · rebookings · idempotency", kind="store", sub_size=8))
    b.append(arrow([(1030, 530), (1030, 580)], "ink", dashed=True))
    b.append(box(980, 580, 130, 62, "Vertex AI Search", "optional FAQ", sub2="else curated snippets", kind="optional", sub_size=8))

    # legend (bottom left)
    lx, ly = 30, 580
    b.append(eyebrow(lx, ly, "Legend"))
    items = [("focal", ACCENT, TINT, ""), ("boundary / guardrail", MUTED, PAPER, "4 3"), ("data store", MUTED, PAPER2, ""), ("external call", LINK, PAPER, "")]
    for i, (n, st, fl, dash) in enumerate(items):
        yy = ly + 14 + i * 17
        d = f' stroke-dasharray="{dash}"' if dash else ""
        b.append(f'<rect x="{lx}" y="{yy}" width="22" height="12" rx="3" fill="{fl}" stroke="{st}"{d}/>')
        b.append(mono(lx + 32, yy + 10, n, size=8.5, fill=MUTED))

    # principle strip
    py = 678
    b.append(f'<line x1="30" y1="{py - 14}" x2="1110" y2="{py - 14}" stroke="{RULE}"/>')
    b.append(text(30, py + 6, "Design principle: the LLM is the last resort.", size=16, family=SERIF, italic=True, fill=INK))
    b.append(box(30, py + 20, 520, 62, "LLM decides nothing about the business", "understands the request · asks only for missing data", sub2="phrases backend results · collects the passenger's explicit yes", kind="default", sub_size=8.5))
    b.append(box(590, py + 20, 520, 62, "Code decides", "identification · eligible alternatives · fees · quote expiry", sub2="idempotency · FSM state · consent guard · simulated failures", kind="focal", sub_size=8.5))
    return svg_doc(W, H, "".join(b), "Escala architecture", "Passenger talks to a CX Agent Studio app with two agents, callbacks and an OpenAPI toolset that calls a hexagonal Firebase Cloud Function backed by Firestore.")


# --------------------------------------------------------------------------------------
# Two-phase confirmation sequence
# --------------------------------------------------------------------------------------


def sequence_svg() -> str:
    W = 1160
    X = {"P": 150, "A": 380, "S": 610, "B": 840, "F": 1040}
    names = {
        "P": ("Passenger", "chat · voice"),
        "A": ("rebooking_agent", "LLM"),
        "S": ("State + guard", "Python tool · callbacks"),
        "B": ("Backend api", "Cloud Function"),
        "F": ("Firestore", "transactions"),
    }
    b = [title_block(30, 36, "Sequence · two-phase confirmation", "No change without a confirmed quote", "Phase 1 quotes and reads back, phase 2 records consent, phase 3 executes behind a guard and a transaction.")]
    top, hh = 104, 46
    for k, (n, s) in names.items():
        b.append(box(X[k] - 78, top, 156, hh, n, s, sub_size=8, name_size=11.5))

    elems: list[str] = []
    y = top + hh + 34

    def phase(title):
        nonlocal y
        elems.append(f'<line x1="24" y1="{y}" x2="{W - 24}" y2="{y}" stroke="{RULE}" stroke-dasharray="3 4"/>')
        elems.append(eyebrow(30, y - 6, title, fill=ACCENT))
        y += 24

    def msg(frm, to, top_label, sub_label=None, dashed=False, color="ink", num=None):
        nonlocal y
        x1, x2 = X[frm], X[to]
        d = 1 if x2 > x1 else -1
        elems.append(arrow([(x1 + 4 * d, y), (x2 - 4 * d, y)], color, dashed=dashed))
        lo, hi = min(x1, x2), max(x1, x2)
        cx = (lo + hi) / 2 if hi - lo < 420 else lo + (hi - lo) / 2
        elems.append(label(cx, y - 7, top_label, size=9, fill=INK if color == "ink" else COLORS[color], mask=True, weight=600))
        if sub_label:
            elems.append(mono(cx, y + 14, sub_label, size=8.5, fill=SOFT, anchor="middle"))
        if num:
            elems.append(f'<circle cx="{lo - 14 if d > 0 else hi + 14}" cy="{y}" r="8" fill="{INK}"/>')
            elems.append(text(lo - 14 if d > 0 else hi + 14, y + 3.5, str(num), size=9, weight=600, fill=PAPER, anchor="middle", family=MONO))
        y += 46 if sub_label else 36

    def note(at, lines, kind="default", width=250, cx=None):
        nonlocal y
        x = cx if cx is not None else X[at]
        h = 14 + 13 * len(lines)
        stroke, fill = (ACCENT, TINT) if kind == "focal" else (MUTED, PAPER2)
        elems.append(f'<rect x="{x - width / 2}" y="{y}" width="{width}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{1.5 if kind == "focal" else 1}"/>')
        for i, ln in enumerate(lines):
            elems.append(mono(x, y + 17 + i * 13, ln, size=8.5, fill=INK if i == 0 else MUTED, anchor="middle", weight=600 if i == 0 else 400))
        y += h + 26

    phase("Phase 1 · quote")
    msg("A", "B", "getRebookingOptions(pnr, deadline)", num=1)
    msg("B", "F", "persist quotes", "quote_id · total_ars · expiry", num=2)
    msg("B", "A", "options + quote_id + total_ars", dashed=True, num=3)
    note("S", ["after_tool: track_state", "offered_quotes · offered_totals", "FSM  TRIAGE → OPTIONS"], width=240)
    msg("A", "P", "read-back: flight, changes, total", "ends with «¿Lo confirmo?»", dashed=True, num=4)
    phase("Phase 2 · consent")
    msg("P", "A", "explicit «sí» (+ amount if cost)", num=5)
    msg("A", "S", "record_quote_confirmation", "(quote_id, total_ars)", num=6)
    note("S", ["checks offered_quotes / offered_totals", "QUOTE_NOT_OFFERED · TOTAL_MISMATCH", "sets confirmed_*  ·  FSM → CONFIRM"], width=250)
    phase("Phase 3 · execute")
    msg("A", "S", "createRebooking", "(quote_id, total, idempotency_key, confirmed)", num=7)
    note("S", ["before_tool: guard_mutating_calls", "quote offered? confirmed? total equal?", "else CONFIRMATION_REQUIRED, nothing runs"], kind="focal", width=262)
    msg("S", "B", "forward createRebooking", num=8)
    msg("B", "F", "run transaction", num=9)
    note("F", cx=996, lines=["verify quote: expiry · version · seats", "idempotency ledger · write rebooking", "replay → same result, already_applied"], width=262)
    msg("F", "B", "committed", dashed=True, num=10)
    msg("B", "A", "new PNR + receipt (simulated payment)", dashed=True, num=11)
    note("S", ["after_tool: FSM → DONE", "clear confirmed_* state"], width=210)
    msg("A", "P", "result + per-passenger follow-ups", "only what the response states", dashed=True, num=12)

    H = y + 20
    life = "".join(
        f'<line x1="{X[k]}" y1="{top + hh}" x2="{X[k]}" y2="{H - 14}" stroke="{RULE}" stroke-width="1.2" stroke-dasharray="2 4"/>' for k in X
    )
    body = "".join(b) + life + "".join(elems)
    return svg_doc(W, int(H), body, "Two-phase confirmation sequence", "Sequence of messages between passenger, agent, state and guard, backend and Firestore for a confirmed rebooking.")
