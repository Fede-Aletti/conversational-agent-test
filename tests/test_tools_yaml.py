"""Run escala/evals/tool_tests/*.yaml locally (same YAML as `cxas test-tools`)."""

import pytest
from conftest import ESCALA_APP_DIR, ESCALA_EVALS_DIR
from cxas_local import discover_tool_cases, run_tool_case

CASES = discover_tool_cases(ESCALA_EVALS_DIR / "tool_tests")


@pytest.mark.parametrize(
    "path,case", CASES, ids=[f"{p.stem}::{c.name}" for p, c in CASES]
)
def test_tool_case(path, case):
    result = run_tool_case(ESCALA_APP_DIR, case)
    assert not result.errors, "\n".join(result.errors)

