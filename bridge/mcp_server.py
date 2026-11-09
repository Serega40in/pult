"""Local stdio MCP adapter for PULT Bridge.

The browser bridge daemon must be running first. Configure PULT_API_TOKEN in
the MCP client's environment; never paste this token into a model prompt.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from mcp.server.fastmcp import FastMCP

BASE_URL = os.environ.get("PULT_BASE_URL", "http://127.0.0.1:8765").rstrip("/")
API_TOKEN = os.environ.get("PULT_API_TOKEN", "")
mcp = FastMCP("PULT Browser")


def _request(path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if not API_TOKEN:
        return {"ok": False, "error": "PULT_API_TOKEN is not configured"}
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers={
            "Authorization": f"Bearer {API_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=65) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return {"ok": False, "http_status": exc.code, "error": detail[:2000]}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"ok": False, "error": f"Cannot reach PULT Bridge: {exc}"}


@mcp.tool()
def pult_status() -> dict[str, Any]:
    """Check whether the local PULT Bridge and browser extension are connected."""
    return _request("/v1/status")


@mcp.tool()
def pult_browser_read_page() -> dict[str, Any]:
    """Read the title, URL, and visible text from the currently selected browser tab."""
    return _request("/v1/browser/execute", {"steps": [{"action": "read_page"}]})


@mcp.tool()
def pult_browser_navigate(url: str) -> dict[str, Any]:
    """Open an HTTP or HTTPS URL in the currently selected browser tab."""
    return _request("/v1/browser/execute", {"steps": [{"action": "navigate", "url": url}]})


@mcp.tool()
def pult_browser_click(selector: str) -> dict[str, Any]:
    """Click an element in the selected tab using a CSS selector. Review the target before calling."""
    return _request("/v1/browser/execute", {"steps": [{"action": "click", "selector": selector}]})


@mcp.tool()
def pult_browser_type(selector: str, text: str) -> dict[str, Any]:
    """Type text into a selected field. Do not use for passwords, payment data, or secrets."""
    return _request("/v1/browser/execute", {"steps": [{"action": "type", "selector": selector, "text": text}]})


@mcp.tool()
def pult_browser_scroll(y: int = 500) -> dict[str, Any]:
    """Scroll the currently selected browser tab up or down by up to 5000 pixels."""
    return _request("/v1/browser/execute", {"steps": [{"action": "scroll", "y": y}]})


if __name__ == "__main__":
    mcp.run()
