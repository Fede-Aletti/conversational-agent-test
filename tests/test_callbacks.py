"""Run escala/evals/callback_tests locally (foundry layout)."""

import pytest
from conftest import ESCALA_APP_DIR, ESCALA_EVALS_DIR
from cxas_local import discover_callback_tests, run_callback_test

TESTS = discover_callback_tests(ESCALA_EVALS_DIR / "callback_tests")


@pytest.mark.parametrize("cb_test", TESTS, ids=[t.id for t in TESTS])
def test_callback(cb_test):
    proc = run_callback_test(ESCALA_APP_DIR, cb_test)
    assert proc.returncode == 0, proc.stdout + proc.stderr
