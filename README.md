# Multichat

A self-hosted web app for discussing a topic with several LLMs at once. You pick the models, state the
topic and your opening thoughts, and the models reply to you and to each other, so they can challenge and
correct one another.

Source code, issues and updates: <https://github.com/tr0llchen/MultiChat>

- Works with any **OpenAI-compatible** API (OpenAI, OpenRouter, Ollama, Mistral, Groq, vLLM, LM Studio, …)
  and the native **Anthropic** Messages API.
- Replies are streamed live to the browser.
- Multi-user with local accounts. Admins manage providers, models and users.
- A single Node.js process with SQLite. No external database is needed.

## Contents

- [Installation](#installation)
  - [Docker (recommended)](#docker-recommended)
  - [From source](#from-source)
- [First steps](#first-steps)
- [Usage](#usage)
- [Configuration](#configuration)
- [Running in production](#running-in-production)
- [Backup and restore](#backup-and-restore)
- [Development](#development)

## Installation

### Docker (recommended)

Requirements: Docker with the Compose plugin.

```sh
git clone https://github.com/tr0llchen/MultiChat.git multichat
cd multichat
cp .env.example .env        # optional, see Configuration
docker compose up -d --build
```

Open <http://localhost:3000>.

> **Important:** the first account created becomes the administrator, and anyone who can reach the app
> can create it. Create the admin account right after you start the app, before you expose it on a network.
> To keep the app on your own machine only, change the port mapping in `docker-compose.yml` to
> `"127.0.0.1:${PORT:-3000}:3000"`.

The database and the generated encryption secret are kept in the `multichat-data` Docker volume.

Useful commands:

```sh
docker compose logs -f                 # follow the logs
git pull && docker compose up -d --build   # update
docker compose down                    # stop (the data volume is kept)
```

### From source

Requirements: **Node.js 26** or newer. The server uses the built-in `node:sqlite` module and
`crypto.argon2`, and Node runs the server's TypeScript directly.

```sh
git clone https://github.com/tr0llchen/MultiChat.git multichat
cd multichat
npm ci
npm run build                 # builds the frontend into web/dist
npm start                     # serves the app and API on http://localhost:3000
```

Data is written to `./data` (set `DATA_DIR` to change this). Settings are read from environment variables,
not from `.env`, so set them in your shell or service manager. For example:

```sh
APP_SECRET="$(openssl rand -base64 32)" PORT=8080 npm start
```

## First steps

1. Open the app and **create the admin account** (username: 2–32 characters from `A-Z a-z 0-9 . _ -`;
   password: at least 8 characters).
2. Go to **Providers and models** and add a provider:

   | Provider | API type | Base URL | API key |
   |---|---|---|---|
   | OpenAI | OpenAI-compatible | `https://api.openai.com/v1` (default) | required |
   | OpenRouter | OpenAI-compatible | `https://openrouter.ai/api/v1` | required |
   | Ollama on the Docker host | OpenAI-compatible | `http://host.docker.internal:11434/v1` | leave empty |
   | Ollama, running from source | OpenAI-compatible | `http://localhost:11434/v1` | leave empty |
   | Anthropic | Anthropic | `https://api.anthropic.com` (default) | required |

3. Load the provider's model list and tick the models you want to offer. You can rename or disable models
   later.
4. Optionally, create accounts for other people under **Users**.
5. Start a **New discussion**.

## Usage

### Starting a discussion

On **New discussion**, enter:

- **Topic**: the question or subject. All models see it in their instructions.
- **Participants**: up to 8. The same model can join more than once, for example with different roles.
  Each participant can have a **name** (used for `@mentions`) and an optional **role**, for example
  *"Argue against the proposal"* or *"You are a security reviewer"*.
- **Mode**:
  - **Models discuss with each other**: after each of your messages the models take turns for up to the
    configured number of rounds (1–10). The run ends early when every model passes.
  - **Each model replies once**: every model replies once, in order.
- **Opening thoughts** (optional): your first message. Without it, the models start on the topic alone.

### During a discussion

- You can write at any time. A new message **interrupts** the model that is replying, and the partial
  reply is kept.
- `@Name` addresses specific participants. Only they reply, once each. Example:
  `@Claude what do you think of GPT's second point?`
- **Stop** ends the current run. **Continue** lets the models go on without a new message from you.
- A model with nothing to add replies `[PASS]`. Passes are hidden.
- If a model fails (wrong key, rate limit, timeout), the error is shown in place of its reply and the model
  is skipped for the rest of the run. The other models carry on.
- **Settings** in the discussion header changes the title, the mode and the number of rounds, or deletes
  the discussion.

### Users and permissions

| | User | Admin |
|---|---|---|
| Create and use their own discussions | ✓ | ✓ |
| See other users' discussions | – | – |
| Manage providers, models and API keys | – | ✓ |
| Create users, reset passwords, change roles | – | ✓ |

Everyone can change their own password under **Account**. Changing a password signs out all other
sessions of that account.

> Every user can run discussions with every enabled model, and the cost goes to the API keys the admin
> entered. There are no per-user quotas, so only create accounts for people you trust with your API budget.

## Configuration

All settings are optional environment variables. With Docker, put them in `.env` (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (with Docker: the port on the host) |
| `APP_SECRET` | generated | Encrypts provider API keys in the database. If unset, a random secret is created in `DATA_DIR/secret.key` |
| `COOKIE_SECURE` | `false` | Set to `true` when the app is served over HTTPS |
| `HOST` | `0.0.0.0` | Interface to listen on (running from source) |
| `DATA_DIR` | `./data` (Docker: `/data`) | Where the SQLite database and `secret.key` are stored |
| `WEB_DIR` | `web/dist` | Directory with the built frontend |
| `MAX_OUTPUT_TOKENS` | `4096` | Maximum reply length for Anthropic models. OpenAI-compatible servers use their own default |

**About `APP_SECRET`:** if you change or remove it, the stored API keys can no longer be decrypted and must
be entered again. The generated `secret.key` is stored next to the database, so a copy of the data
directory contains both the encrypted keys and the secret to decrypt them. Set `APP_SECRET` separately if
backups of the database should not reveal your API keys.

## Running in production

The app serves plain HTTP. To expose it beyond your own machine:

1. Put it behind a reverse proxy that terminates HTTPS (Caddy, nginx, Traefik, …).
2. Set `COOKIE_SECURE=true`.
3. Bind the container to localhost only (`"127.0.0.1:3000:3000"`), so it can only be reached through
   the proxy.
4. Make sure the proxy does not buffer `/api/discussions/*/events` (server-sent events) and allows
   long-lived connections. The app sends `X-Accel-Buffering: no`, which nginx respects.

Caddy:

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_read_timeout 1h;
    proxy_buffering off;
}
```

## Backup and restore

Everything is stored in the data directory: `multichat.db` (plus its `-wal`/`-shm` files) and, if
`APP_SECRET` is not set, `secret.key`.

```sh
# Docker: write a consistent snapshot of the database, then copy it out of the volume
docker compose exec multichat node -e \
  "new (require('node:sqlite').DatabaseSync)('/data/multichat.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp multichat:/data/backup.db ./multichat-backup.db
docker compose cp multichat:/data/secret.key ./secret.key   # only if APP_SECRET is not set
```

To restore, stop the app, put the files back into the data directory as `multichat.db` (and `secret.key`)
and start it again.

## Development

```sh
npm install
npm run dev:server   # API on :3000, restarts on change
npm run dev:web      # frontend on :5173 with hot reload, proxies /api to :3000
npm test             # server tests (node:test)
npm run typecheck    # server and frontend
```

Project layout:

```
server/            Fastify API, SQLite through node:sqlite
  src/routes/      auth, providers and models, discussions (incl. server-sent events)
  src/engine/      turn-taking, prompts, @mentions, [PASS] handling
  src/providers/   OpenAI-compatible and Anthropic streaming adapters
  test/            API and engine tests with a fake provider
web/               React, Vite and Tailwind frontend
```

Only the frontend has a build step. Database migrations live in `server/src/db.ts` and run automatically
at startup.
