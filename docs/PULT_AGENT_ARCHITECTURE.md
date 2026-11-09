# PULT Agent: command hub architecture

Status: architecture proposal for the next implementation stage. This document does not claim that a server has been deployed or connected.

## Goal

Turn PULT from a ChatGPT code-block executor into a provider-independent agent platform:

- ChatGPT can remain the reasoning interface during the first phase.
- The Chrome extension is the local browser executor and the bridge between the ChatGPT page and PULT.
- A small PHP API on the existing hosting provides a durable command queue, device pairing, task status, and audit history.
- A future first-party PULT Chat UI and model router use the same API and tool contract.
- Additional executors (Windows desktop and Android) register as separate devices and expose their own capabilities.

The architecture must not depend on ChatGPT Work/Codex credits, one model vendor, or one hosting provider.

## Important platform boundary

The current ChatGPT web conversation cannot make arbitrary HTTP requests to an arbitrary user endpoint just because that endpoint exists. Custom MCP app access and write-capable connections are restricted by the ChatGPT plan and workspace controls. Therefore, in the first phase the Chrome extension reads a deliberately formatted `pult` plan from the assistant response and submits it to PULT. The assistant does not directly write into the PHP queue.

For the first phase, the user explicitly approves the execution from the extension UI. The extension submits the plan to the PHP API, the local executor claims it, executes the validated steps, then posts the result. The result is shown in the ChatGPT page and can be inserted into the composer for the user to send back. This preserves the working interaction that has already been tested while moving execution and result tracking behind a reusable API.

When the first-party PULT Chat UI exists, it can submit tasks and receive results directly through the same API. A supported MCP connector can also be added later, without redesigning the executor protocol.

## High-level components

1. **PULT Chat / reasoning client**
   - Phase 1: the existing ChatGPT page, with the extension detecting fenced `pult` JSON plans.
   - Later: first-party web chat, model-provider adapters, persistent task history, streaming status.

2. **PULT API / command hub**
   - PHP 8.x REST API over HTTPS, suitable for shared hosting.
   - MySQL through PDO for durable queue state (the available hosting account has a single database, so use the existing database rather than requiring another one).
   - Device pairing, access tokens, task claims, leases, result submission, health/status and audit events.
   - No arbitrary code execution and no public unauthenticated command endpoint.

3. **PULT Chrome extension**
   - Detects a valid PULT plan in a ChatGPT assistant message.
   - Shows a review/execute control.
   - Sends the approved task to the API.
   - Runs only allow-listed browser actions against the selected tab.
   - Submits the result and displays it beside the originating plan.
   - Keeps the device token in extension storage; never hard-code credentials in source or Git.

4. **PULT executors**
   - Chrome extension first.
   - Windows agent later: window/app controls, files and permitted desktop actions.
   - Android companion later: explicit user-granted accessibility/notification/media permissions and a narrow command set. No silent device takeover.

5. **Model router (future first-party chat)**
   - Provider adapters for OpenAI-compatible APIs and other supported providers.
   - Optional local model adapter.
   - Per-task model selection, rate-limit-aware fallback, token/cost budgets and usage logs.
   - No assumption of unlimited free inference.

## Phase 1 request lifecycle

1. The user asks for a task in ChatGPT.
2. The assistant returns a bounded JSON plan in a fenced `pult` block.
3. The extension validates the JSON locally and presents a preview of the requested actions.
4. The user chooses the target tab and approves execution.
5. The extension posts the job to `POST /api/v1/jobs`.
6. The extension executor claims the job with `POST /api/v1/jobs/claim` (or directly starts the just-created job in the same extension session).
7. Each step is checked against the action allow-list and policy; execution stops on the first error or policy boundary.
8. The extension posts the result to `POST /api/v1/jobs/{id}/complete`.
9. The API stores the result and emits an audit event. The extension displays the result and offers to insert it into the ChatGPT composer.
10. The user sends the result to ChatGPT, which plans the next batch.

The queue is useful for persistence, retries, future multiple devices, and the first-party chat. On the initial single-browser setup, a local message can wake the executor immediately; periodic polling is a fallback and allows later remote task submission.

## API v1 contract

All endpoints require HTTPS and authenticated device credentials, except a short-lived one-time pairing initiation endpoint. JSON only. Responses use a stable envelope:

```json
{ "ok": true, "data": {}, "request_id": "..." }
```

Errors:

```json
{ "ok": false, "error": { "code": "INVALID_PLAN", "message": "..." }, "request_id": "..." }
```

Initial endpoints:

- `POST /api/v1/pair/start` — create a short-lived one-time pairing challenge.
- `POST /api/v1/pair/complete` — exchange a user-entered pairing code for a device token.
- `GET /api/v1/health` — version and service health; no private details.
- `POST /api/v1/jobs` — submit a validated plan from an authenticated client.
- `POST /api/v1/jobs/claim` — claim the next queued job for a registered executor using an expiring lease.
- `POST /api/v1/jobs/{id}/heartbeat` — renew a lease for a long-running task.
- `POST /api/v1/jobs/{id}/complete` — submit success/failure result and release the lease.
- `GET /api/v1/jobs/{id}` — return status/result to the submitting client.

The first phase may use a simpler synchronous `submit -> execute -> complete` sequence. The queue/lease contract should nevertheless be established now so that multiple devices can be added without changing the API.

## Initial job shape

```json
{
  "schema_version": "1",
  "client": "chatgpt-bridge",
  "target": { "device_id": "paired-device-id", "tab_id": 123 },
  "policy": { "require_confirmation": true },
  "steps": [
    { "action": "navigate", "url": "https://example.com" },
    { "action": "wait", "ms": 800 },
    { "action": "read_page", "max_chars": 12000 }
  ],
  "expires_in": 300
}
```

Keep the currently tested actions initially: `navigate`, `read_page`, `click`, `type`, `scroll`, and `wait`. Continue to block passwords, hidden fields, payment data, file uploads, arbitrary JavaScript, shell execution and unapproved form submission. Add capabilities only with separate validation and permission rules.

## Storage model

Use a small InnoDB schema, not a shared JSON file as the authoritative queue:

- `pult_devices`: device ID, display name, token hash, capabilities, last seen, revoked timestamp.
- `pult_pairings`: hashed one-time code, expiry, used timestamp.
- `pult_jobs`: job ID, device target, plan JSON, status, created/claimed/completed timestamps, lease expiry, attempt count, result JSON, error code.
- `pult_events`: append-only task and security events.

A JSON file can be used for a local smoke-test fixture, but is not suitable as the shared queue of record: concurrent reads/writes, partial writes, race conditions and file exposure make it fragile. MySQL transactions and conditional updates provide a better fit for the existing single-database hosting plan.

## Security requirements

- HTTPS only; reject plain HTTP in production.
- Random high-entropy device tokens; store only token hashes on the server.
- One-time pairing code with short expiry and single use.
- Bind every job to an authorized device; allow revocation.
- Validate size, schema, step count, action names, URL protocol and selector/text lengths on both server and extension.
- Never accept arbitrary JavaScript, shell, PHP, filesystem paths or executable downloads as tasks.
- Browser actions are scoped to the explicitly selected tab and allowed HTTP/HTTPS sites.
- Sensitive inputs and payment-related pages are protected. Submission, deletion, purchase, sending messages, uploading files and other external side effects require a separate user confirmation.
- Limit polling rate, payload size, job lifetime and retries; add request IDs and audit logs.
- Do not put API tokens, account passwords, session cookies or personal site data in the public repository.
- Treat webpage text as untrusted input. It may inform a task but cannot override the user's policy or expand permissions.

## Model limits: what PULT does and does not solve

PULT removes the need for a model call for deterministic browser execution. Opening a URL, waiting, scrolling, collecting a selected DOM region, deduplicating rows, validating fields and formatting a CSV can run as ordinary code.

PULT does **not** remove model token limits, request quotas, context limits, provider rate limits or API billing. A model-driven agent still needs inference for planning, interpretation and recovery. Multi-step agents can make repeated model calls.

The future router should reduce dependence on any one limit by:
- using deterministic code for simple operations;
- sending only relevant DOM snippets instead of whole pages;
- summarizing and checkpointing long tasks;
- caching stable instructions and site metadata;
- limiting screenshot use to cases where DOM inspection is insufficient;
- assigning simple classification/extraction to smaller models;
- routing reasoning to a capable provider when needed;
- respecting provider quotas and using fallback only when configured;
- optionally using a local model, accepting the quality/speed trade-off.

Nanobrowser follows the same broad model: the browser agent is free/open source, while the user supplies a cloud model/API key or a local model. This is model choice, not unlimited inference.

## Implementation milestones

### M0 — Preserve the working baseline
- Keep current PULT Lite browser actions and the manual result-return workflow.
- Add no new broad permissions without need.

### M1 — PHP command hub
- Confirm the PHP version, HTTPS host path and MySQL credentials through the hosting panel (never place credentials in chat or Git).
- Create schema and API files under a dedicated, non-public data directory where supported.
- Implement health, pair, submit, claim, complete and status endpoints.
- Add a local PHP test fixture and endpoint smoke tests.

### M2 — Extension bridge
- Add API URL and one-time pairing UI.
- Store device token in chrome.storage.local.
- On user approval, submit the detected plan, execute through the existing validated executor and post the result.
- Display status, errors and result in ChatGPT.
- Verify page reads, navigation, clicks, typing and scroll against harmless test pages.

### M3 — First-party PULT Chat
- Build a simple web chat that submits a user task and receives model responses.
- Connect model providers through a provider-neutral adapter.
- Use the same PULT API and executor, not a second browser-control implementation.

### M4 — Windows and Android
- Add independently paired executors and explicit capability manifests.
- Introduce per-device permissions, approvals and audit trail.

## Acceptance criteria for M1/M2

- Pairing succeeds without embedding secrets in the repository.
- An unpaired client cannot submit, claim or read jobs.
- Duplicate completion and expired leases are handled safely.
- Extension can submit a plan and receive the exact execution result.
- Unsupported or sensitive actions are rejected both server-side and client-side.
- The Chrome executor still works when the API is briefly unavailable, using the existing local-only mode.
- No user-facing claim is made that ChatGPT directly called the API in this phase.
