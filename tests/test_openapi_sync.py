"""The lean CES toolset schema must expose the same contract as the backend OpenAPI."""

import pytest
import yaml
from conftest import ESCALA_APP_DIR, REPO_ROOT

CES = (
    ESCALA_APP_DIR
    / "toolsets/escala_api/open_api_toolset/open_api_schema.yaml"
)
BACKEND = REPO_ROOT / "escala/backend/functions/src/http/openapi.yaml"
METHODS = {"get", "post", "put", "patch", "delete"}


def _load(path):
    return yaml.safe_load(path.read_text())


def _contract(spec):
    ops = {}
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if method not in METHODS:
                continue
            params = {
                (p["name"], p["in"]): bool(p.get("required", False))
                for p in op.get("parameters", [])
            }
            body = (
                op.get("requestBody", {})
                .get("content", {})
                .get("application/json", {})
                .get("schema", {})
            )
            ops[op["operationId"]] = {
                "path": path,
                "method": method,
                "params": params,
                "body_required": sorted(body.get("required", [])),
                "body_fields": sorted(body.get("properties", {})),
                "body_optional": not op.get("requestBody", {}).get("required", False),
            }
    return ops


@pytest.fixture(scope="module")
def specs():
    return _load(CES), _load(BACKEND)


def test_same_operations(specs):
    ces, backend = (_contract(s) for s in specs)
    assert set(ces) == set(backend)


@pytest.mark.parametrize("field", ["path", "method", "params", "body_required",
                                   "body_fields", "body_optional"])
def test_same_contract(specs, field):
    ces, backend = (_contract(s) for s in specs)
    for op_id in backend:
        assert ces[op_id][field] == backend[op_id][field], f"{op_id}.{field}"


def test_same_servers(specs):
    ces, backend = specs
    assert [s["url"] for s in ces["servers"]] == [s["url"] for s in backend["servers"]]
