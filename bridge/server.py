"""PULT local browser bridge.

The API is intentionally bound to loopback. A browser extension establishes an
outbound WebSocket connection; local MCP/API clients submit validated plans.
"""
from __future__ import annotations

import asyncio
import os
import secrets
import uuid
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

API_TOKEN = os.environ.get("PULT_API_TOKEN", "")
EXTENSION_TOKEN = os.environ.get("PULT_EXTENSION_TOKEN", "")
EXTENSION_ID = os.environ.get("PULT_EXTENSION_ID", "")
BROWSER_WS_URL = "/v1/browser/ws"

if not API_TOKEN or not EXTENSION_TOKEN:
    raise RuntimeError(
        "Set PULT_API_TOKEN and PULT_EXTENSION_TOKEN before starting PULT Bridge."
    )

app = FastAPI(
    title="PULT Bridge API",
    version="0.2.0",
    description="Authenticated loopback API for PULT browser automation.",
    docs_url="/docs",
    redoc_url=None,
)

_browser_socket: WebSocket | None = None
_pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
_pending_lock = asyncio.Lock()


class BrowserPlan(BaseModel):
    steps: list[dict[str, Any]] = Field(min_length=1, max_length=20)
    timeout_ms: int = Field(default=30000, ge=1000, le=60000)


def _authorize(authorization: str | None) -> None:
    if not secrets.compare_digest(authorization or "", f"Bearer {API_TOKEN}"):
        raise HTTPException(status_code=401, detail="Invalid PULT API token")


def _validate_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Allow only a small, explicit action vocabulary. Never execute JS from API."""
    allowed: list[dict[str, Any]] = []
    for index, raw in enumerate(steps):
        if not isinstance(raw, dict):
            raise HTTPException(400, f"Step {index + 1} must be an object")
        action = raw.get("action")
        if action == "navigate":
            url = raw.get("url")
            if not isinstance(url, str) or len(url) > 2048:
                raise HTTPException(400, f"Step {index + 1}: invalid URL")
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise HTTPException(400, f"Step {index + 1}: only http/https URLs are allowed")
            allowed.append({"action": action, "url": url})
        elif action in ("click", "type"):
            selector = raw.get("selector")
            if not isinstance(selector, str) or not selector or len(selector) > 500:
                raise HTTPException(400, f"Step {index + 1}: invalid CSS selector")
            if action == "click":
                allowed.append({"action": action, "selector": selector})
            else:
                value = raw.get("text", "")
                if not isinstance(value, str) or len(value) > 10000:
                    raise HTTPException(400, f"Step {index + 1}: text must be <= 10000 characters")
                allowed.append({"action": action, "selector": selector, "text": value})
        elif action == "scroll":
            y = raw.get("y", 500)
            if not isinstance(y, int) or isinstance(y, bool) or not -5000 <= y <= 5000:
                raise HTTPException(400, f"Step {index + 1}: scroll y must be between -5000 and 5000")
            allowed.append({"action": action, "y": y})
        elif action == "wait":
            ms = raw.get("ms", 1000)
            if not isinstance(ms, int) or isinstance(ms, bool) or not 0 <= ms <= 10000:
                raise HTTPException(400, f"Step {index + 1}: wait must be between 0 and 10000 ms")
            allowed.append({"action": action, "ms": ms})
        elif action == "read_page":
            allowed.append({"action": action})
        else:
            raise HTTPException(400, f"Step {index + 1}: unsupported action {action!r}")
    return allowed


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "pult-bridge"}


@app.get("/v1/status")
async def status(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _authorize(authorization)
    return {
        "service": "pult-bridge",
        "browser_connected": _browser_socket is not None,
        "transport": "websocket",
        "browser_actions": ["navigate", "click", "type", "scroll", "wait", "read_page"],
    }


@app.post("/v1/browser/execute")
async def browser_execute(
    plan: BrowserPlan,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _authorize(authorization)
    steps = _validate_steps(plan.steps)
    socket = _browser_socket
    if socket is None:
        raise HTTPException(503, "PULT extension is not connected. Open the extension on a browser tab.")

    request_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    future: asyncio.Future[dict[str, Any]] = loop.create_future()
    async with _pending_lock:
        _pending[request_id] = future

    try:
        await socket.send_json({"type": "execute", "id": request_id, "steps": steps})
        try:
            result = await asyncio.wait_for(future, timeout=plan.timeout_ms / 1000)
        except asyncio.TimeoutError:
            raise HTTPException(504, "Browser execution timed out")
        return {"request_id": request_id, **result}
    except WebSocketDisconnect:
        raise HTTPException(503, "PULT extension disconnected during execution")
    finally:
        async with _pending_lock:
            _pending.pop(request_id, None)


@app.websocket(BROWSER_WS_URL)
async def browser_websocket(websocket: WebSocket) -> None:
    global _browser_socket

    # Chrome extensions send chrome-extension://<extension-id> as Origin.
    origin = websocket.headers.get("origin", "")
    expected_origin = f"chrome-extension://{EXTENSION_ID}" if EXTENSION_ID else ""
    if not expected_origin or not secrets.compare_digest(origin, expected_origin):
        await websocket.close(code=1008, reason="Untrusted extension origin")
        return

    await websocket.accept()
    try:
        auth = await asyncio.wait_for(websocket.receive_json(), timeout=8)
        supplied = auth.get("token", "") if isinstance(auth, dict) else ""
        if auth.get("type") != "auth" or not secrets.compare_digest(str(supplied), EXTENSION_TOKEN):
            await websocket.close(code=1008, reason="Authentication failed")
            return

        if _browser_socket is not None:
            await websocket.close(code=1013, reason="Another PULT extension is already connected")
            return

        _browser_socket = websocket
        await websocket.send_json({"type": "ready", "service": "pult-bridge"})

        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif message.get("type") == "result":
                request_id = str(message.get("id", ""))
                async with _pending_lock:
                    future = _pending.get(request_id)
                if future is not None and not future.done():
                    future.set_result({
                        "ok": bool(message.get("ok")),
                        "results": message.get("results", []),
                        "error": message.get("error"),
                    })
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        if _browser_socket is websocket:
            _browser_socket = None
        # Wake any in-flight API calls rather than leaving them waiting.
        async with _pending_lock:
            for future in _pending.values():
                if not future.done():
                    future.set_result({"ok": False, "error": "Browser extension disconnected", "results": []})
