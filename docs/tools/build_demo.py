"""Build docs/assets/demo.gif: step-by-step replay of the resolved simulator session (simulator-b4030042).

Left: chat bubbles (Spanish original + English gloss) and tool calls. Right: the FSM with the active state,
the edge just taken, the tool call that caused it, and per-turn tokens/latency. Data comes from the CES trace
report of that session (see escala/docs/learnings.md).

Requires playwright (chromium), ffmpeg is NOT needed, gifski is.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from playwright.sync_api import sync_playwright

import diagrams
from svgkit import ACCENT, INK, LINK, MUTED, PAPER, PAPER2, RULE, SOFT, TINT, esc

ASSETS = Path(__file__).resolve().parent.parent / "assets"

# (tokens_in, tokens_out, latency_s) per turn, from the trace report
METRICS = {0: (5282, 85, 2.61), 1: (17601, 199, 5.35), 2: (6464, 74, 1.36), 3: (20524, 187, 4.18), 4: (22971, 136, 3.66), 5: (16028, 57, 2.03)}
TOTALS = {"turns": 6, "tools": 10, "llm": 15, "tokens_in": 88870, "tokens_out": 738, "latency": 19.2}


@dataclass
class Step:
    turn: int
    items: list  # chat items appended by this step
    state: str | None
    hot: str | None
    visited: set
    tool: tuple | None  # (name, args, result)
    transition: str | None
    hold: int  # number of 0.5 s ticks
    show_metrics: bool = False
    final: bool = False


def user(es, en=None):
    return ("user", es, en)


def agent(who, es, en):
    return ("agent", who, es, en)


def tool(name, result):
    return ("tool", name, result)


T0_USER = user(
    "Hola, viajamos dos de Córdoba a Bariloche con escala en Aeroparque. Me cancelaron el primer vuelo y necesito llegar mañana como máximo. Mi pareja ya hizo el check-in y pagamos equipaje adicional. ¿Nos podés cambiar a los dos sin perder lo que pagamos?",
    "Hi, two of us are flying Córdoba to Bariloche via Aeroparque. Our first flight was cancelled and I need to arrive tomorrow at the latest. My partner already checked in and we paid for extra baggage. Can you change both of us without losing what we paid?",
)
T0_A1 = agent(
    "root_agent",
    "Aviso: soy un asistente experimental de Escala, un prototipo que no está afiliado a Aerolíneas Argentinas. Los datos y los cambios son simulados.",
    "Notice: I'm an experimental Escala assistant, a prototype not affiliated with Aerolíneas Argentinas. Data and changes are simulated.",
)
T0_A2 = agent(
    "root_agent",
    "Hola, lamento mucho la cancelación de tu vuelo. Para poder ayudarte a buscar opciones de cambio para los dos y revisar lo del equipaje, ¿me podrías pasar el código de reserva y el apellido de alguno de los pasajeros?",
    "Hi, I'm very sorry about the cancellation. To look for change options for both of you and check the baggage, could you give me the booking code and the surname of one of the passengers?",
)
T1_USER = user("RMR4TX Romero", None)
T1_A = agent(
    "disruption_rebooking_agent",
    "Tengo dos opciones disponibles para ustedes que llegan antes del límite de mañana. La opción A es un vuelo directo de Córdoba a Bariloche el trece de noviembre, saliendo a las nueve y quince de la mañana y llegando a las once y cuarenta. La opción B tiene escala en Aeroparque el trece de noviembre, saliendo a las siete de la mañana y llegando a Bariloche a las doce y cinco del mediodía. ¿Cuál de las dos prefieren?",
    "I have two options that arrive before tomorrow's limit. Option A is a direct Córdoba-Bariloche flight on November 13, departing 09:15 and arriving 11:40. Option B stops at Aeroparque on November 13, departing 07:00 and arriving in Bariloche at 12:05. Which one do you prefer?",
)
T2_USER = user("La A", "Option A.")
T2_A = agent(
    "disruption_rebooking_agent",
    "Para la opción A, el vuelo directo, el equipaje adicional de los dos se transfiere sin costo. Joaquín deberá realizar el check-in nuevamente para el nuevo vuelo, y la selección de asientos no se mantiene, por lo que la devolución de ese cargo la gestionará un agente humano. El cambio es sin costo, ¿lo confirmo?",
    "For option A, the direct flight, both extra bags transfer at no cost. Joaquín must check in again for the new flight, and the seat selection is not kept, so a human agent will handle that refund. The change is free; shall I confirm it?",
)
T3_USER = user("Si es sin costo si, sino quiero una devolucion", "If it's free, yes; otherwise I want a refund.")
T3_A = agent(
    "disruption_rebooking_agent",
    "El cambio ya fue realizado sin costo y el nuevo código de confirmación es K K U F W 5, con el comprobante R C guion dos E A B C F. El equipaje de los dos se transfiere sin cargo, pero Joaquín deberá volver a realizar el check-in para el nuevo vuelo directo del trece de noviembre a las nueve y quince de la mañana. ¿Te puedo ayudar con algo más?",
    "The change is done at no cost. The new confirmation code is K K U F W 5, receipt R C dash 2 E A B C F. Both bags transfer free, but Joaquín must check in again for the new direct flight on November 13 at 09:15. Can I help with anything else?",
)
T4_USER = user(
    "Si, sabemos en que puerta y cuando puedo hacer el check-in del nuevo vuelo?",
    "Yes. Do we know the gate and when I can check in for the new flight?",
)
T4_A = agent(
    "disruption_rebooking_agent",
    "La puerta de embarque todavía no está asignada para ese vuelo. El check-in online suele abrir entre veinticuatro y cuarenta y ocho horas antes de la salida, pero te sugiero confirmarlo en aerolineas.com.ar. ¿Hay algo más en lo que te pueda colaborar?",
    "The boarding gate is not assigned yet. Online check-in usually opens 24 to 48 hours before departure, but I suggest confirming on aerolineas.com.ar. Anything else I can help with?",
)
T5_USER = user("no gracias", "No, thanks.")


def build_steps() -> list[Step]:
    S = []
    v: set = set()

    def add(turn, items, state, hot, tool_=None, transition=None, hold=3, metrics=False, final=False):
        S.append(Step(turn, items, state, hot, set(v), tool_, transition, hold, metrics, final))

    add(0, [T0_USER], None, None, hold=4)
    v.add("start")
    add(0, [tool("searchFaq", "ok")], "IDENTIFY", "start", ("escala_api_searchFaq", "q: cambio de vuelo cancelado equipaje adicional...", "status ok · stays in IDENTIFY"), "fsm_state: (empty) → IDENTIFY", hold=3)
    add(0, [T0_A1, T0_A2], "IDENTIFY", None, hold=5, metrics=True)
    add(1, [T1_USER], "IDENTIFY", None, hold=2)
    v.add("ident_triage")
    add(1, [tool("lookupBooking", "ok")], "TRIAGE", "ident_triage", ("escala_api_lookupBooking", "pnr: RMR4TX · last_name: Romero", "status ok · cancellation, connection broken"), "fsm_state: IDENTIFY → TRIAGE", hold=3)
    v.add("triage_options")
    add(1, [tool("transfer_to_agent", "rebooking"), tool("getRebookingOptions", "2 quotes")], "OPTIONS", "triage_options", ("escala_api_getRebookingOptions", "pnr: RMR4TX · deadline: tomorrow", "status ok · quotes Q-F8675A92, Q-CE92DEA3"), "fsm_state: TRIAGE → OPTIONS", hold=4)
    add(1, [T1_A], "OPTIONS", None, hold=6, metrics=True)
    add(2, [T2_USER], "OPTIONS", None, hold=2)
    add(2, [T2_A], "OPTIONS", None, hold=6, metrics=True)
    add(3, [T3_USER], "OPTIONS", None, hold=3)
    v.add("opt_confirm")
    add(3, [tool("record_quote_confirmation", "confirmed")], "CONFIRM", "opt_confirm", ("record_quote_confirmation", "quote_id: Q-F8675A92 · total_ars: 0", "status success · guard now armed"), "fsm_state: OPTIONS → CONFIRM", hold=4)
    v.add("confirm_done")
    add(3, [tool("createRebooking", "booked")], "DONE", "confirm_done", ("escala_api_createRebooking", "quote_id · confirmed: true · idempotency_key: rebook-Q-F8675A92", "status ok · simulated_paid ARS 0"), "fsm_state: CONFIRM → DONE", hold=4)
    add(3, [T3_A], "DONE", None, hold=6, metrics=True)
    add(4, [T4_USER], "DONE", None, hold=3)
    add(4, [tool("getFlightStatus", "ok"), tool("searchFaq", "ok")], "DONE", None, ("escala_api_getFlightStatus + searchFaq", "gate and check-in questions", "status ok · state stays DONE"), "no transition: read-only tools", hold=3)
    add(4, [T4_A], "DONE", None, hold=5, metrics=True)
    add(5, [T5_USER], "DONE", None, hold=2)
    add(5, [tool("set_session_outcome", "resolved"), tool("end_session", "ended")], "DONE", None, ("set_session_outcome + end_session", "outcome: resolved", "session closed, no escalation"), "fsm_state: DONE (final)", hold=4, metrics=True)
    add(5, [], "DONE", None, hold=14, final=True)
    return S


CSS = f"""
*{{box-sizing:border-box}}
html,body{{margin:0;background:{PAPER};font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:{INK}}}
.frame{{width:1100px;height:640px;position:relative;overflow:hidden}}
.top{{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid {RULE}}}
.top .t{{font-family:'Instrument Serif',Georgia,serif;font-size:22px}}
.top .e{{font:500 9px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:{ACCENT};margin-right:10px}}
.top .r{{font:600 11px ui-monospace,Menlo,monospace;color:{MUTED}}}
.chat{{position:absolute;left:20px;top:62px;width:410px;height:566px;display:flex;flex-direction:column;justify-content:flex-end;gap:7px;overflow:hidden}}
.b{{max-width:372px;padding:8px 11px;border-radius:10px;font-size:12px;line-height:1.38}}
.b .en{{margin-top:5px;padding-top:5px;border-top:1px dashed rgba(127,127,127,.45);font-size:10.5px;font-style:italic;opacity:.82}}
.b .en:before{{content:'EN ';font:600 8px ui-monospace,Menlo,monospace;font-style:normal;letter-spacing:.1em}}
.u{{align-self:flex-end;background:{INK};color:{PAPER};border-bottom-right-radius:3px}}
.a{{align-self:flex-start;background:#fff;border:1px solid {RULE};border-bottom-left-radius:3px}}
.a .en{{color:{SOFT}}}
.who{{align-self:flex-start;font:500 8px ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:{SOFT};margin:2px 0 -4px 2px}}
.tool{{align-self:center;font:500 10px ui-monospace,Menlo,monospace;color:{LINK};border:1px solid {LINK};border-radius:999px;padding:3px 10px;background:{PAPER}}}
.tool b{{color:{INK};font-weight:600}}
.right{{position:absolute;left:446px;top:62px;width:640px}}
.card{{margin-top:8px;border:1px solid {RULE};border-radius:8px;padding:10px 14px;background:{PAPER2}}}
.card.hot{{border-color:{ACCENT};background:{TINT}}}
.card .h{{font:500 8px ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:{SOFT};margin-bottom:5px}}
.card .m{{font:600 12px ui-monospace,Menlo,monospace;color:{INK}}}
.card .s{{font:400 10.5px ui-monospace,Menlo,monospace;color:{MUTED};margin-top:3px}}
.card .x{{font:600 11px ui-monospace,Menlo,monospace;color:{ACCENT};margin-top:6px}}
.row{{display:flex;gap:8px}}
.row .card{{flex:1}}
.big{{font:600 17px ui-monospace,Menlo,monospace;color:{INK}}}
.final{{font:400 21px 'Instrument Serif',Georgia,serif}}
"""


def chat_html(items) -> str:
    out = []
    for it in items:
        if it[0] == "user":
            en = f'<div class="en">{esc(it[2])}</div>' if it[2] else ""
            out.append(f'<div class="b u">{esc(it[1])}{en}</div>')
        elif it[0] == "agent":
            out.append(f'<div class="who">{esc(it[1])}</div><div class="b a">{esc(it[2])}<div class="en">{esc(it[3])}</div></div>')
        else:
            out.append(f'<div class="tool">tool · <b>{esc(it[1])}</b> → {esc(it[2])}</div>')
    return "".join(out)


def frame_html(step: Step, history: list) -> str:
    n = step.turn
    mtr = METRICS[n]
    svg = diagrams.fsm_replay_svg(step.state, step.hot, step.visited)
    svg = svg.replace('width="700" height="430"', 'width="640" height="393"')
    if step.final:
        cards = (
            f'<div class="card hot"><div class="h">Session result</div><div class="final">Resolved: new flight booked at no cost, only after the passenger confirmed.</div>'
            f'<div class="s" style="margin-top:6px">{TOTALS["turns"]} turns · {TOTALS["tools"]} tool calls · {TOTALS["llm"]} LLM calls · {TOTALS["latency"]} s perceived</div></div>'
            f'<div class="row"><div class="card"><div class="h">Input tokens (total)</div><div class="big">{TOTALS["tokens_in"]:,}</div></div>'
            f'<div class="card"><div class="h">Output tokens (total)</div><div class="big">{TOTALS["tokens_out"]:,}</div></div>'
            f'<div class="card"><div class="h">Per LLM call (input)</div><div class="big">2.5k-8k</div></div></div>'
        )
    else:
        if step.tool:
            name, args, res = step.tool
            tool_card = (
                f'<div class="card hot"><div class="h">Tool call that moved the state</div><div class="m">{esc(name)}</div>'
                f'<div class="s">{esc(args)}</div><div class="s">→ {esc(res)}</div><div class="x">{esc(step.transition or "")}</div></div>'
            )
        else:
            tool_card = '<div class="card"><div class="h">Waiting for the next tool call</div><div class="s">The state only changes when a tool result arrives.</div></div>'
        if step.show_metrics:
            met = (f'<div class="card"><div class="h">Turn {n + 1} · tokens in / out</div><div class="big">{mtr[0]:,} / {mtr[1]}</div></div>'
                   f'<div class="card"><div class="h">Turn {n + 1} · perceived latency</div><div class="big">{mtr[2]:.2f} s</div></div>')
        else:
            met = (f'<div class="card"><div class="h">Turn {n + 1} · tokens in / out</div><div class="big" style="color:{RULE}">…</div></div>'
                   f'<div class="card"><div class="h">Turn {n + 1} · perceived latency</div><div class="big" style="color:{RULE}">…</div></div>')
        cards = tool_card + f'<div class="row">{met}</div>'
    return (
        f"<style>{CSS}</style><div class='frame'><div class='top'><div><span class='e'>Escala</span><span class='t'>Replay of a resolved session</span></div>"
        f"<div class='r'>simulator-b4030042 · turn {n + 1}/6</div></div>"
        f"<div class='chat'>{chat_html(history)}</div><div class='right'>{svg}{cards}</div></div>"
    )


def main() -> None:
    steps = build_steps()
    tmp = Path(tempfile.mkdtemp(prefix="escala-demo-"))
    frames: list[Path] = []
    history: list = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1100, "height": 640}, device_scale_factor=2)
        for i, step in enumerate(steps):
            history = history + step.items
            page.set_content(f"<!doctype html><html><head><meta charset='utf-8'></head><body>{frame_html(step, history)}</body></html>")
            path = tmp / f"f{i:03d}.png"
            page.screenshot(path=str(path))
            frames.append(path)
        browser.close()
    # constant 2 fps: repeat frames to hold them (1 tick = 0.5 s)
    seq = tmp / "seq"
    seq.mkdir()
    k = 0
    for step, path in zip(steps, frames):
        for _ in range(step.hold):
            shutil.copy(path, seq / f"s{k:04d}.png")
            k += 1
    out = ASSETS / "demo.gif"
    subprocess.run(["gifski", "--fps", "2", "--width", "1100", "--quality", "100", "--output", str(out), *sorted(map(str, seq.glob("s*.png")))], check=True)
    print(f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB), {len(steps)} steps, {k} ticks")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
