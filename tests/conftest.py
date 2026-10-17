"""Shared paths for the offline CXAS test harness."""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
ESCALA_APP_DIR = REPO_ROOT / "escala" / "cxas_app" / "escala"
ESCALA_EVALS_DIR = REPO_ROOT / "escala" / "evals"


@pytest.fixture(scope="session")
def escala_app_dir() -> Path:
    return ESCALA_APP_DIR


@pytest.fixture(scope="session")
def escala_evals_dir() -> Path:
    return ESCALA_EVALS_DIR
