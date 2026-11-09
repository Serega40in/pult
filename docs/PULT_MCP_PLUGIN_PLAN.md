# PULT MCP Plugin for ChatGPT

This document tracks the explicit requirement to expose PULT as a tool plugin inside ChatGPT, in addition to the independent first-party PULT Chat.

## Product goal

The user should be able to ask in ordinary language, for example:

> Open Avito, review comparable listings, prepare a draft listing and show it to me before publication.

ChatGPT should call PULT tools, receive actual browser observations, reason over them, and request the next actions. PULT executes browser work on the user's paired Chrome device. The same backend must also be usable by the future PULT Chat and other model clients.

## Why the MCP plugin is a separate deliverable

The PHP REST API used by Chrome and PULT Chat is not automatically an MCP server. ChatGPT's custom-app connection requires a remote MCP endpoint reachable over HTTPS and a supported MCP transport. The plugin must describe narrow tools and authentication; it must not expose an unrestricted generic HTTP proxy.

OpenAI's current ChatGPT help documentation states:
- Free accounts do not have custom MCP server connections.
- Pro accounts can connect custom MCP servers for read/fetch actions, but not full write actions.
- Full MCP support, including write/modify actions, is available to Business and Enterprise/Edu.
- ChatGPT connects to a remote HTTPS MCP server; a local PHP process on the user's computer is not directly reachable without a supported secure tunnel.

This is a ChatGPT product entitlement. PULT cannot override it by changing its API, manifest, plugin package, or authentication scheme. The implementation should remain useful without ChatGPT's custom MCP feature.

## MCP endpoint

Proposed endpoint after deployment:

`https://<PULT-DOMAIN>/pult-api/mcp`

Transport: MCP Streamable HTTP.

The MCP server is an adapter over the PULT application service. It must not duplicate the browser executor or expose raw database operations.

## Proposed tools

Read tools:
- `pult_status` — service health, API version and connected-device status for the authenticated user.
- `pult_list_devices` — paired devices, online/last-seen status and permitted capabilities.
- `pult_get_job` — status and result of one task owned by the authenticated user.
- `pult_list_jobs` — recent tasks owned by the authenticated user.

Task tools:
- `pult_create_job` — create a bounded plan for a selected paired device. The job is **pending local approval** and cannot be executed merely because the model created it.
- `pult_cancel_job` — cancel a queued job before it is claimed.

Do not initially provide:
- `pult_execute_arbitrary_code`
- `pult_run_shell`
- `pult_read_cookies`
- `pult_get_passwords`
- silent form submission, publication, payment, deletion or message sending

A future user-approved action may be modelled as a separate explicit confirmation tool, but browser-side confirmation remains the default for consequential actions.

## Device execution lifecycle

1. ChatGPT calls `pult_create_job`.
2. The API stores the job in queued/pending-approval state.
3. The paired Chrome extension polls for pending jobs and displays a human-readable preview.
4. The user approves or rejects the task in the extension / PULT control panel.
5. The device claims the job under a short lease, executes only allow-listed actions and posts the result.
6. ChatGPT calls `pult_get_job` and continues from observed results.

This keeps the model's planning authority separate from the user's authority to let a device act.

## Authentication and identity

For a ChatGPT MCP connection with user-specific data and write actions, implement OAuth 2.1 authorization-code flow with PKCE (S256), scopes, expiry and refresh-token handling according to the current OpenAI and MCP requirements. Do not put a long-lived static API key in a plugin manifest or a prompt. OpenAI's current MCP auth guidance does not support arbitrary customer-supplied API keys/custom headers as a substitute for OAuth.

A future QUN ID integration may provide the identity layer if its OAuth/OIDC implementation is verified to meet the required discovery, PKCE and token-audience contracts. Otherwise implement a narrowly scoped PULT authorization service. Do not reuse device pairing secrets as human OAuth credentials.

The MCP adapter validates access tokens and user ownership for every request. It then uses internal service calls to the job store. The Chrome device continues to use its separate random device token. User tokens and device tokens are never interchangeable.

## ChatGPT plugin/package

Once the HTTPS MCP endpoint and OAuth flow are deployed and verified:
1. Create a private PULT plugin/app that points to the verified `/mcp` endpoint.
2. Scan and inspect the published tool schemas and their read/write annotations.
3. Connect it in ChatGPT only where the account/workspace supports the intended actions.
4. Test harmless read tools first, then task creation with a local approval gate.
5. Refresh the tool list when the server changes.

Do not create a placeholder plugin with a fake endpoint. Keep the exact plugin ID and release ID for future updates.

## Independent PULT Chat

The first-party PULT Chat must use the same PULT application service and job model. Its server can authenticate directly with PULT's user identity system and call the internal service without depending on ChatGPT's MCP entitlements. A model router can then select configured cloud or local models, respecting their individual quotas, terms and resource limits.

## Verification checklist

- MCP endpoint supports initialize, tools/list and tools/call over Streamable HTTP.
- OAuth metadata, authorization code + PKCE S256, scopes, token audience, expiration and refresh behavior pass tests.
- No user can inspect another user's devices or jobs.
- Model-created jobs remain non-executable until a device-side user approval.
- Revoking a user or device token immediately blocks further access.
- Tools expose only task-level operations, never raw SQL or unrestricted command execution.
- ChatGPT connection succeeds only on a plan/workspace that supports the selected read/write capability.
