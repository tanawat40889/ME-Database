# TG Vault

Private media vault using Telegram as the only source of truth. See [SPEC.md](SPEC.md).

## Setup

```bash
npm install
cp .env.example .env
```

Fill `TG_API_ID` / `TG_API_HASH` from https://my.telegram.org, then:

```bash
npm run login          # prints TG_SESSION
npm run hash-password  # prints APP_PASSWORD_HASH
openssl rand -base64 48  # SESSION_SECRET
```

## Scripts

| Script                         | Purpose                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `npm run dev`                  | server (watch)                                                                   |
| `npm run dev:web`              | Vite dev server (proxies `/api` to :8080)                                        |
| `npm run dev:mock`             | web UI with a fake API (no Telegram needed), password `demo`                     |
| `npm run build`                | build web + server                                                               |
| `npm test`                     | unit tests                                                                       |
| `npm run hash-password`        | print `APP_PASSWORD_HASH` (scrypt) from a hidden prompt                          |
| `npm run list-chats`           | show chats that will / won't be indexed                                          |
| `npm run watch`                | load snapshot, catch up, then log live updates + nightly rescan (Ctrl+C to stop) |
| `npm run scan [-- --q "ซ้อม"]` | full scan → `data/index.json`, print categories + search                         |

## HTTP

`npm run build && npm start` serves API + web on `PORT`. Locally over plain http set `COOKIE_SECURE=0`.
Behind a proxy/tunnel set `TRUST_PROXY=1`. Every `/api/*` needs the `tgv_session` cookie (400-day sliding);
bump `SESSION_VERSION` to log out every device. `/health` is public but minimal (full details with a session).

## Deploy (Docker)

One image holds server + built web. It must run on a machine that stays on (VPS, Fly.io, Railway, a home box + Cloudflare Tunnel). Not Netlify Functions: streaming hits timeout/size limits.

1. Fill `.env` (see Setup). Keep the single quotes around `APP_PASSWORD_HASH`: docker compose would expand the `$` parts otherwise.
2. Set `TRUST_PROXY=1` when HTTPS terminates in a proxy/tunnel in front, so rate limits see the real client IP. Leave `COOKIE_SECURE=1`.
3. Start:

```bash
docker compose up -d --build
```

- Port 8080 is published on `127.0.0.1` only. Point your HTTPS front (Cloudflare Tunnel, Caddy, nginx) at it. Never expose it over plain http.
- `restart: unless-stopped` brings it back after crashes/reboots. The image `HEALTHCHECK` calls `/health` and reports unhealthy if the server is down or Telegram is disconnected (`docker ps` shows it).
- `/data` (volume `tg-vault-data`) holds `index.json` and thumbnails. It is only a cache: delete it and the next start rescans Telegram.
- Logs: `docker compose logs -f`. Stop: `docker compose stop` (flushes the snapshot first).
- Kick every device out: bump `SESSION_VERSION` in `.env`, then `docker compose up -d`.

## Notes

- Enable the ❤️ reaction in each vault chat's settings (channel: Channel Settings → Reactions), otherwise favoriting returns `REACTION_INVALID`.
- Never commit `.env` or `data/`. `TG_SESSION` is equivalent to the account password.
- Private use only. Do not expose publicly.
