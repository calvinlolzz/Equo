from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("smoke-production-api.py")

NO_STORE = {"Cache-Control": "no-store"}
OFF = (200, NO_STORE, {"liff_id": None})
ON = (200, NO_STORE, {"liff_id": "2008123456-AbCdEfGh"})
UNAVAILABLE = (503, NO_STORE, {"error": {"code": "LINE_UNAVAILABLE", "message": "off", "request_id": "r"}})
INVALID = (401, NO_STORE, {"error": {"code": "LINE_ID_TOKEN_INVALID", "message": "bad", "request_id": "r"}})
REFUSED = (401, {}, {"error": {"code": "UNAUTHENTICATED", "message": "no", "request_id": "r"}})


def load_module():
    spec = importlib.util.spec_from_file_location("smoke_production_api", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load smoke-production-api.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    module = load_module()
    judge = module.evaluate_liff
    failures: list[str] = []

    def expect_ok(label: str, *responses) -> None:
        problem = judge(*responses)
        if problem is not None:
            failures.append(f"{label}: expected pass, got: {problem}")

    def expect_fail(label: str, *responses) -> None:
        if judge(*responses) is None:
            failures.append(f"{label}: expected a failure, got a pass")

    # The two healthy deployments.
    expect_ok("LIFF unconfigured", OFF, UNAVAILABLE, REFUSED)
    expect_ok("LIFF configured", ON, INVALID, REFUSED)

    # The config endpoint.
    expect_fail("config 404 (route missing)", (404, {}, {"error": {"code": "NOT_FOUND"}}), UNAVAILABLE, REFUSED)
    expect_fail("config without liff_id", (200, NO_STORE, {}), UNAVAILABLE, REFUSED)
    expect_fail("liff_id of the wrong type", (200, NO_STORE, {"liff_id": 12345}), INVALID, REFUSED)
    expect_fail("config cacheable", (200, {}, {"liff_id": None}), UNAVAILABLE, REFUSED)
    expect_ok("header name in lower case", (200, {"cache-control": "no-store"}, {"liff_id": None}), UNAVAILABLE, REFUSED)

    # The exchange must agree with the config in both directions.
    expect_fail("configured but exchange says unavailable", ON, UNAVAILABLE, REFUSED)
    expect_fail("unconfigured but exchange reaches LINE", OFF, INVALID, REFUSED)
    expect_fail("exchange route missing", ON, (404, {}, {"error": {"code": "NOT_FOUND"}}), REFUSED)
    expect_fail("exchange 500", ON, (500, {}, {"error": {"code": "INTERNAL_ERROR"}}), REFUSED)
    expect_fail("exchange succeeded on junk", ON, (200, NO_STORE, {"session": {"token": "equoL1.a.b"}}), REFUSED)
    expect_fail("exchange minted a token with an error status", ON, (401, NO_STORE, {"token": "equoL1.a.b"}), REFUSED)

    # No cookie from the exchange, whatever the status or header case.
    expect_fail("Set-Cookie on the exchange", ON, (401, {**NO_STORE, "Set-Cookie": "equo_session=x"}, INVALID[2]), REFUSED)
    expect_fail("set-cookie in lower case", ON, (401, {**NO_STORE, "set-cookie": "equo_session=x"}, INVALID[2]), REFUSED)

    # The gate.
    expect_fail("forged LIFF bearer reaches the route (200)", ON, INVALID, (200, {}, {"groups": []}))
    expect_fail("forged LIFF bearer is 403, not 401", ON, INVALID, (403, {}, {"error": {"code": "LIFF_SCOPE"}}))
    expect_fail("forged LIFF bearer is 404", ON, INVALID, (404, {}, None))

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1

    print("OK: production API smoke rules verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
