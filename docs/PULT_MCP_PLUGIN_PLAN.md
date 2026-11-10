# PULT MCP Plugin for ChatGPT

A dedicated PULT MCP connector remains a planned integration, but it is not a prerequisite for an initial working bridge in this conversation.

## What works now

The current ChatGPT conversation has access to the connected Supabase tools. Those tools can create a command row in QUN's existing `public.qun_agent_commands` queue and read the result once the paired extension finishes the task. PULT Lite then checks the queue, displays the plan and waits for the user to approve it.

This is the simplest MVP: no extra ChatGPT API key, no PHP server, no new cloud database and no dependence on Work/Codex credits.

## Existing MCP endpoint

QUN Agent Core is already deployed as a Supabase Edge Function and contains an MCP Streamable HTTP endpoint:

`https://qdxjltqlnphvzafapncm.supabase.co/functions/v1/qun-agent-core/mcp`

The function's current MCP handler uses the `QUN_AGENT_MCP_KEY` project secret. This can be used by a compatible MCP client with the appropriate auth mechanism, but a custom endpoint does not override ChatGPT plan/workspace restrictions. The MCP tool `qun_browser_execute_plan` has been added for future use.

## Planned tools

- `qun_agent_status` — current device status.
- `qun_browser_list_tabs` — list browser tabs.
- `qun_browser_read_active_page` — read active page.
- `qun_browser_open_url` — open an HTTP/HTTPS URL.
- `qun_browser_execute_plan` — queue a validated plan of up to eight browser steps for a selected paired device.
- `qun_agent_get_command_result` — obtain job status/result.
- Future cancel/reject tools where appropriate.

The browser device displays tasks and requires a separate confirmation before execution. Avoid unrestricted code-execution tools, shell commands, password/cookie access, hidden/payment fields, or blind submission of forms.

## ChatGPT plan boundary

Whether a user can add a custom MCP server and use write-capable tools depends on the ChatGPT plan and workspace policy. The current integration is not marketed as a way to bypass those limits. The native Supabase connector is the practical bridge for the current chat; a first-party PULT Chat can later use the same backend independently of ChatGPT's custom-connector availability.

## Next verification

- Generate a short-lived pairing code through the connected Supabase tools.
- Pair PULT Lite and verify heartbeat/queue preview.
- Queue a harmless `navigate + wait + read_page` plan.
- Confirm from the database that the job is leased, completed and its result can be read.
