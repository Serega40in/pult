# PULT Agent: Supabase-first architecture

Status: implemented source plus a deployed additive extension to QUN Agent Core. The browser extension integration still needs a live pairing/execution test on the user's Chrome.

## Core decision

Do not build a second PHP/MySQL command server. QUN already has a Supabase project, command queue and Edge Function:

- Supabase project: QUN.
- Existing queue: `public.qun_agent_commands`.
- Existing device registry: `public.qun_agent_devices`.
- Existing Edge Function and MCP adapter: `qun-agent-core`.

PULT reuses this backend. GitHub remains the source/version control for code; Supabase stores live device state, queued tasks and results.

## End-to-end workflow in the current ChatGPT chat

1. The user asks a normal-language browser task.
2. The assistant uses its already-connected Supabase tools to insert a validated command row in `qun_agent_commands`.
3. PULT Lite checks the QUN Agent Core queue and shows a pending task in its popup.
4. The user inspects the step plan and explicitly approves or rejects it.
5. The browser extension claims the selected queued command using its per-device token.
6. The extension executes only allow-listed browser actions against the selected ordinary HTTP/HTTPS tab.
7. The extension stores the outcome through QUN Agent Core; ChatGPT retrieves the status/result through the existing Supabase connector and continues.

This works without relying on ChatGPT Work/Codex credits and without a separate API subscription. The assistant does not directly call arbitrary HTTP endpoints from the web chat; it uses the Supabase connector already available to this conversation.

## QUN Agent Core API additions

The existing `qun-agent-core` Edge Function continues to provide the original `/agent/*` endpoints and MCP tools. Additive `/pult/*` endpoints support PULT-specific per-device authentication and explicit approval:

- `POST /pult/pair` — exchange a short-lived, single-use pairing code for an individual random device token.
- `POST /pult/heartbeat` — update browser device presence.
- `POST /pult/peek` — read the oldest queued task without claiming it.
- `POST /pult/claim` — claim a specific queued task after the user presses the execute button.
- `POST /pult/result` — save a completed/failed result.
- `POST /pult/reject` — cancel a queued task.
- `POST /pult/disconnect` — revoke the paired device token.

Pairing codes are stored as SHA-256 hashes in `qun_agent_pairing_codes`; device token hashes and revocation state are stored on `qun_agent_devices`. The extension only receives and stores the generated token. The global `QUN_AGENT_DEVICE_KEY` is not copied into the browser extension.

## Command contract

The queue retains its existing safe commands and adds `browser.execute_plan` with an `args.steps` array:

```json
{
  "device_id": "pult-chrome-main",
  "action": "browser.execute_plan",
  "args": {
    "steps": [
      {"action": "navigate", "url": "https://www.avito.ru"},
      {"action": "wait", "ms": 1000},
      {"action": "read_page"}
    ]
  },
  "status": "queued",
  "requested_by": "chatgpt"
}
```

Both the Edge Function and the extension validate the plan. Maximum 8 steps and 12 KB plan payload. Supported steps are `navigate`, `read_page`, `click`, `type`, `scroll` and `wait`. The browser executor continues to block sensitive fields, arbitrary JavaScript, shell commands and HTML form submission.

## Explicit approval and task integrity

- ChatGPT may create a queued task, but the queue does not execute it by itself.
- PULT shows the task's ID, action and arguments. The user approves or rejects in the extension.
- The Edge Function grants a short lease to one executor; the command must still be queued and bound to the same device ID when claimed.
- Results and errors are persisted in the same row; the assistant can retrieve them through Supabase.
- Pairing codes expire and are one-time use. Device tokens can be revoked from the extension.

## Model independence

PULT removes needless model calls for deterministic execution and lets future PULT Chat route inference among configured cloud/local providers. It does not bypass a model's quotas, context limits or provider terms. Separate model adapters, token budgets, task checkpoints and deterministic code reduce reliance on a single provider.

## Future work

1. Complete live Chrome pairing and harmless URL/read-page smoke test.
2. Add tool-call UX in PULT Chat, using the same queue and result contract.
3. Add explicit confirmations for consequential web actions (publishing, payments, deletion, message sending).
4. Add Windows and Android executors as separate paired devices.
5. Publish a custom PULT MCP plugin when the target ChatGPT plan/connection flow supports the required capabilities.
