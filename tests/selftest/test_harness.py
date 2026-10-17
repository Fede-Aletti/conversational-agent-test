"""Prove the harness works independent of escala content."""

from pathlib import Path

import pytest
from cxas_local import (
    discover_callback_tests,
    discover_tool_cases,
    run_callback_test,
    run_tool_case,
)
from cxas_local.tools import execute_tool

HERE = Path(__file__).parent
APP = HERE / "app"
CASES = discover_tool_cases(HERE / "evals" / "tool_tests")
CB_TESTS = discover_callback_tests(HERE / "evals" / "callback_tests")


def test_discovery_finds_fixtures():
    assert len(CASES) == 3
    assert [t.id for t in CB_TESTS] == ["main/before_model_callbacks/before_model"]


@pytest.mark.parametrize("path,case", CASES, ids=[c.name for _, c in CASES])
def test_selftest_tool_cases(path, case):
    result = run_tool_case(APP, case)
    assert not result.errors, result.errors


def test_response_shape_matches_platform():
    _, case = CASES[0]
    out = execute_tool(APP, case)
    assert set(out) == {"response", "variables"}
    assert out["response"]["result"]["status"] == "success"
    assert out["variables"]["last_name"] == "Ana"


def test_failing_expectation_is_reported():
    _, case = CASES[0]
    case.response_expectations[0].value = "nope"
    assert run_tool_case(APP, case).errors


def test_tool_exception_is_a_failure():
    _, case = CASES[0]
    case.args = {"wrong_arg": 1}
    assert "Tool raised" in run_tool_case(APP, case).errors[0]


def test_unknown_tool_raises():
    _, case = CASES[0]
    case.tool = "missing"
    with pytest.raises(LookupError):
        run_tool_case(APP, case)


@pytest.mark.parametrize("cb_test", CB_TESTS, ids=[t.id for t in CB_TESTS])
def test_selftest_callbacks(cb_test):
    proc = run_callback_test(APP, cb_test)
    assert proc.returncode == 0, proc.stdout + proc.stderr
