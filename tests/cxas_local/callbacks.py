"""Run foundry-layout callback tests locally.

Layout (same as ``cxas test-callbacks`` / ``scripts/sync-callbacks.py``)::

    <evals>/callback_tests/tests/<agent>/<type>_callbacks/<base>/test.py

``<base>`` is the callback type without ``_callbacks`` (``before_model``), with
``_<idx>`` appended when the agent has several callbacks of that type. The code
under test is read straight from ``<app_dir>/agents/<agent>/<type>_callbacks/
<name>/python_code.py``, so no sync step is needed locally.

Execution mirrors ``CallbackEvals._run_test``: the code gets the
``from cxas_scrapi.utils.callback_libs import *`` / ``import json`` prelude, and
test + code are copied into a temp dir that is the pytest cwd and sys.path root.
It runs in a subprocess (instead of the SDK's in-process runner, which hides
pytest output) so failures show the real traceback and runs stay isolated.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

PRELUDE = "from cxas_scrapi.utils.callback_libs import *\nimport json\n\n"


@dataclass(frozen=True)
class CallbackTest:
    agent: str
    callback_type: str
    base: str
    test_file: Path

    @property
    def id(self) -> str:
        return f"{self.agent}/{self.callback_type}/{self.base}"


def discover_callback_tests(callback_tests_dir: Path) -> list[CallbackTest]:
    tests_root = callback_tests_dir / "tests"
    if not tests_root.is_dir():
        return []
    return [
        CallbackTest(p.parts[-4], p.parts[-3], p.parts[-2], p)
        for p in sorted(tests_root.glob("*/*_callbacks/*/test.py"))
    ]


def _code_path(app_dir: Path, test: CallbackTest) -> Path:
    type_dir = app_dir / "agents" / test.agent / test.callback_type
    entries = sorted(
        p / "python_code.py"
        for p in type_dir.glob("*")
        if (p / "python_code.py").is_file()
    )
    prefix = test.callback_type.removesuffix("_callbacks")
    if len(entries) == 1 and test.base == prefix:
        return entries[0]
    for idx, path in enumerate(entries):
        if test.base == f"{prefix}_{idx}":
            return path
    raise FileNotFoundError(
        f"No callback code in {type_dir} matches test '{test.base}'"
    )


def run_callback_test(app_dir: Path, test: CallbackTest) -> subprocess.CompletedProcess:
    code = _code_path(app_dir, test).read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / "python_code.py").write_text(PRELUDE + code, encoding="utf-8")
        (tmp_path / "test_callback_under_test.py").write_text(
            test.test_file.read_text(encoding="utf-8"), encoding="utf-8"
        )
        return subprocess.run(
            [
                sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                "-o", "addopts=", "test_callback_under_test.py",
            ],
            cwd=tmp_path,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
