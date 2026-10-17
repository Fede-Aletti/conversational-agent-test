"""Run Python-function tools locally with platform-equivalent semantics.

Platform semantics emulated (see ``cxas_scrapi.core.tools.Tools.execute_tool``
and ``ToolEvals.validate_tool_test``):

* The tool source is executed with a ``context`` global (a ``ToolContext``)
  whose ``state`` holds the test case ``variables`` (or ``context.state`` when
  the case uses ``context:``). ``context`` is NOT a function parameter.
* The platform returns ``{"response": {"result": <return value>},
  "variables": <state after execution>}``; expectations are evaluated by
  ``ToolEvals.validate_tool_test`` against ``response`` and ``variables``.
  That is why response JSONPaths look like ``$.result.status``.

Known divergences: no network/auth, so ``variables: {name: null}`` (meaning
"fetch the app variable") cannot be resolved and is treated as unset; the exact
platform sandbox (allowed imports, timeouts) is not enforced.
"""

from __future__ import annotations

import ast
import json
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from cxas_scrapi.evals.tool_evals import ToolEvals, ToolTestCase
from cxas_scrapi.utils.callback_libs import ToolContext

# ToolEvals.__init__ builds authenticated API clients. The helpers we reuse
# (loading, JSONPath lookup, operator checks) never touch instance state, so we
# create an instance without running __init__ and make no API calls.
_EVALS = ToolEvals.__new__(ToolEvals)


@dataclass
class ToolCaseResult:
    case: ToolTestCase
    response: dict[str, Any] | None
    errors: list[str]


def load_tool_cases_from_dir(directory: Path) -> list[tuple[Path, ToolTestCase]]:
    """Load every ``tests:`` case from ``*.yaml``/``*.yml`` under a directory."""
    found: list[tuple[Path, ToolTestCase]] = []
    if not directory.is_dir():
        return found
    for path in sorted([*directory.rglob("*.yaml"), *directory.rglob("*.yml")]):
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not raw or "tests" not in raw:
            continue
        for case in _EVALS.load_tool_test_cases_from_data(raw["tests"]):
            found.append((path, case))
    return found


discover_tool_cases = load_tool_cases_from_dir


def _tool_dirs(app_dir: Path) -> dict[str, Path]:
    """Map tool display name and directory name to its python_code.py."""
    mapping: dict[str, Path] = {}
    tools_root = app_dir / "tools"
    if not tools_root.is_dir():
        return mapping
    for tool_dir in sorted(p for p in tools_root.iterdir() if p.is_dir()):
        code = tool_dir / "python_function" / "python_code.py"
        if not code.is_file():
            continue
        mapping[tool_dir.name] = code
        meta = tool_dir / f"{tool_dir.name}.json"
        if meta.is_file():
            try:
                display = json.loads(meta.read_text(encoding="utf-8")).get(
                    "displayName"
                )
            except json.JSONDecodeError:
                display = None
            if display:
                mapping[display] = code
    return mapping


def _select_function(source: str, namespace: dict[str, Any], tool: str):
    if callable(namespace.get(tool)):
        return namespace[tool]
    top_level = [
        n.name
        for n in ast.parse(source).body
        if isinstance(n, ast.FunctionDef) and not n.name.startswith("_")
    ]
    if len(top_level) == 1:
        return namespace[top_level[0]]
    raise LookupError(
        f"Cannot pick the entrypoint for tool '{tool}'; public functions: "
        f"{top_level}"
    )


def execute_tool(app_dir: Path, case: ToolTestCase) -> dict[str, Any]:
    """Execute a tool and return a platform-shaped ``executeTool`` response."""
    code_path = _tool_dirs(app_dir).get(case.tool)
    if code_path is None:
        raise LookupError(f"Tool '{case.tool}' not found under {app_dir}/tools")

    if case.context:
        ctx_data = dict(case.context)
        ctx_data["state"] = dict(ctx_data.get("state") or {})
        context = ToolContext(**ctx_data)
    else:
        variables = {k: v for k, v in case.variables.items() if v is not None}
        context = ToolContext(state=variables)

    source = code_path.read_text(encoding="utf-8")
    namespace: dict[str, Any] = {"__name__": "python_code", "context": context}
    exec(compile(source, str(code_path), "exec"), namespace)  # noqa: S102
    result = _select_function(source, namespace, case.tool)(**case.args)
    return {"response": {"result": result}, "variables": context.state}


def run_tool_case(app_dir: Path, case: ToolTestCase) -> ToolCaseResult:
    """Run one case and evaluate it with the SDK's own expectation checker."""
    try:
        response = execute_tool(app_dir, case)
    except LookupError:
        raise
    except Exception:  # the platform reports tool exceptions as failures
        return ToolCaseResult(
            case, None, [f"Tool raised:\n{traceback.format_exc()}"]
        )
    return ToolCaseResult(case, response, _EVALS.validate_tool_test(case, response))
