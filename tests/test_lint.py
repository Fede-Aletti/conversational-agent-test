"""Offline structural lint of the escala app (`cxas lint`, no API calls)."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import ESCALA_APP_DIR, REPO_ROOT


def test_cxas_lint_has_no_errors():
    if not (ESCALA_APP_DIR / "agents").is_dir():
        pytest.skip(f"{ESCALA_APP_DIR.relative_to(REPO_ROOT)} has no agents/ yet")
    cxas = shutil.which("cxas", path=str(Path(sys.executable).parent))
    if cxas is None:
        pytest.fail("cxas CLI not found next to the test interpreter")
    proc = subprocess.run(
        [cxas, "lint", "--json", "--app-dir", str(ESCALA_APP_DIR)],
        capture_output=True, text=True, cwd=REPO_ROOT, check=False,
    )
    try:
        report = json.loads(proc.stdout)
    except json.JSONDecodeError:
        pytest.fail(f"cxas lint produced non-JSON output:\n{proc.stdout}\n{proc.stderr}")
    findings = _collect(report)
    errors = [f for f in findings if str(f.get("severity", "")).lower() == "error"]
    assert not errors, json.dumps(errors, indent=2)


def _collect(node):
    """Yield every dict carrying a 'severity' key, whatever the report nesting."""
    out = []
    if isinstance(node, dict):
        if "severity" in node:
            out.append(node)
        for v in node.values():
            out.extend(_collect(v))
    elif isinstance(node, list):
        for v in node:
            out.extend(_collect(v))
    return out
