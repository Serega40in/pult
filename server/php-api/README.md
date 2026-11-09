# PULT PHP API v1

A small REST command hub for the PULT browser executor. Designed for PHP 8.x + MySQL/MariaDB on ordinary HTTPS shared hosting.

**Current status:** source implementation only. It has not been deployed to the hosting account or tested against the live database yet.

## Directory layout

Upload the contents of this directory to a dedicated folder under the HTTPS web root, for example:

```text
public_html/pult-api/
  .htaccess
  index.php
  config.php                 # create from config.example.php; never upload to Git
  config.example.php
  schema.sql
```

Do not put this folder behind a public file index. The supplied `.htaccess` disables directory listing, denies direct reads of configuration/schema/documentation files, and routes API paths to `index.php`.

## Requirements

- PHP 8.0 or newer.
- PHP PDO + pdo_mysql.
- MySQL 5.7+ or a compatible MariaDB version with InnoDB and JSON column support.
- An HTTPS certificate enabled for the domain.
- A database and database user created in the hosting control panel.

No Composer, Node.js, Python, shell access, or paid service is required by this API.

## Install

1. In the hosting control panel, create a dedicated MySQL database and user with privileges only on that database.
2. Import `schema.sql` into this database using phpMyAdmin or the hosting database tool.
3. Copy `config.example.php` to `config.php`.
4. Set the PDO DSN, username and password using the database values from the hosting panel. The DSN format is:

   `mysql:host=DB_HOST;dbname=DB_NAME;charset=utf8mb4`

5. Generate a unique random pairing secret of at least 32 random bytes. Put the secret in `pairing_secret`. Do not reuse a website password.
6. Open Chrome and visit `chrome://extensions`. Copy the PULT extension ID and add its exact origin to `allowed_origins`, e.g. `chrome-extension://<extension-id>`.
7. Visit `https://YOUR-DOMAIN/pult-api/v1/health`. A configured API should respond with JSON containing `"status":"ready"`.
8. Keep `config.php` private. Never commit it, paste it into chat, or send it in screenshots.

## API endpoints

All authenticated routes use:

`Authorization: Bearer <64-character-device-token>`

- `GET /v1/health` — public service health.
- `POST /v1/devices/pair` — exchange the setup pairing secret for a one-time device token. Body: `{"pairing_secret":"...","device_name":"PULT Chrome"}`.
- `POST /v1/jobs` — create a queued task. Body: `{"client_name":"pult-extension","plan":{"steps":[...]}}`.
- `POST /v1/jobs/{job_id}/approve` — explicit local device approval.
- `POST /v1/jobs/claim` — claim an approved task. Body: `{"job_id":"32-hex-id"}`.
- `POST /v1/jobs/{job_id}/complete` — submit execution result. Body: `{"result":{"ok":true,"results":[]}}}`.
- `GET /v1/jobs/{job_id}` — read the status/result for a job belonging to the authenticated device.

Supported browser actions are limited to `navigate`, `read_page`, `click`, `type`, `scroll` and `wait`. A plan has 1–8 steps. The Chrome executor remains responsible for the final browser-specific checks, including protection of sensitive fields and form submission.

The pairing endpoint returns a random device token once. The server stores only its SHA-256 hash. Keep the returned token in Chrome extension storage, not in source code or Git.

## Security model

- HTTPS is mandatory for real use.
- Pairing requires a long random secret configured by the owner.
- Device tokens are random, device-specific and revocable by setting `revoked_at` in `pult_devices`.
- API jobs are bound to the paired device.
- A task is not claimable until the device explicitly approves it.
- Plans and results are size-limited and validated server-side.
- Arbitrary JavaScript, shell commands, filesystem paths, passwords, hidden/payment fields and unapproved form submissions are not part of the API.
- Do not expose database credentials or pairing secrets in Git, ChatGPT messages, screenshots or client-side source.
- Treat page text as untrusted content; a webpage must never be allowed to rewrite PULT permissions or user intent.

## Manual smoke test

Pair a test device from a trusted local script or REST client. Do not paste the pairing secret or returned device token into chat.

Health:

```bash
curl https://YOUR-DOMAIN/pult-api/v1/health
```

Pair (replace placeholders locally):

```bash
curl -X POST https://YOUR-DOMAIN/pult-api/v1/devices/pair \\
  -H "Content-Type: application/json" \\
  -d '{"pairing_secret":"YOUR-LOCAL-PAIRING-SECRET","device_name":"PULT test"}'
```

Use the returned device token locally to create a harmless test job, approve it, claim it and submit a result. The API source does not deploy itself; the extension bridge is a separate milestone.

## Known next work

- Connect the PULT extension settings UI to this API.
- Pair the extension and store its device token in `chrome.storage.local`.
- On the existing explicit "Execute in PULT" click, create/approve/claim the API job, execute through the already-tested browser executor, then submit the result.
- Add polling and a pending-approval inbox for tasks created by a future first-party PULT Chat or a supported MCP integration.
- Add an MCP endpoint and OAuth 2.1 only after the API and device execution path is verified. ChatGPT plan restrictions still apply: a server cannot grant write-capable MCP access to a ChatGPT plan that does not support it.
