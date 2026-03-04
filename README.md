# CollabMD

Realtime collaborative Markdown editor with live preview, Mermaid diagrams, and a Node-based collaboration server.

## Production-oriented changes

- Cleaned up the codebase into `src/client`, `src/server`, and `public`.
- Removed the monolithic browser script and split the client into application, infrastructure, presentation, and domain modules.
- Added on-disk room persistence under `data/rooms` so rooms survive server restarts.
- Added a repeatable client build step and a multi-stage Docker image for VPS/Coolify deployment.
- Switched the collaboration client to same-origin WebSocket routing by default using `/ws/:room`.

## Architecture

```text
src/
  client/
    application/     app orchestration and preview rendering
    domain/          default content and room/user generators
    infrastructure/  runtime config and collaborative editor session
    presentation/    theme, layout, outline, and toast controllers
  server/
    config/          environment loading
    domain/          collaboration room model and registry
    infrastructure/  HTTP, persistence, and WebSocket adapters
public/
  assets/css/        static styles
  index.html         app shell
scripts/
  build-client.mjs   client bundling and vendored browser assets
```

## Requirements

- Node.js 24+
- npm

## Local development

Install dependencies:

```bash
npm install
```

Build and run the app:

```bash
npm start
```

Open:

```text
http://localhost:1234
```

Useful commands:

```bash
npm run build
npm run check
npm run start:prod
npm run test
npm run test:unit
npm run test:e2e
npm run tunnel
npm run start:tunnel
```

`npm start` always rebuilds the browser bundle before starting the server. `npm run start:prod` expects a previous `npm run build`.

## Testing

The repo now has two automated test layers:

- `npm run test:unit`
  Fast Node-based coverage for persistence, HTTP endpoints, and WebSocket collaboration behavior.
- `npm run test:e2e`
  Blackbox Playwright coverage that boots the full app, drives the browser UI, and verifies preview + collaboration flows.
- `npm run test`
  Runs both suites.

Install the Playwright browser once on a new machine:

```bash
npx playwright install chromium
```

Test layout:

```text
tests/
  node/   Node test runner coverage for server/domain/integration behavior
  e2e/    Playwright browser tests against a real running app
```

The Playwright suite starts its own isolated test server on `127.0.0.1:4173` and stores temporary room data under `.tmp/`.

## Cloudflare Tunnel

The app can be exposed from your local machine through a Cloudflare Tunnel. Since the editor already uses same-origin WebSocket routing (`/ws/:room`), the tunnel works for both HTTP and collaboration traffic without extra app changes.

Install `cloudflared` first:

- macOS: `brew install cloudflared`
- Linux / Windows: use the official Cloudflare Tunnel installer

Run the local app and the tunnel in one command:

```bash
npm run start:tunnel
```

If you already have the app running locally, start only the tunnel:

```bash
npm run tunnel
```

The quick tunnel points to `http://127.0.0.1:1234` by default. You can override that with environment variables:

```bash
TUNNEL_TARGET_PORT=4000 npm run tunnel
TUNNEL_TARGET_URL=http://127.0.0.1:4000 npm run tunnel
```

You can also pass extra `cloudflared` flags:

```bash
CLOUDFLARED_EXTRA_ARGS="--loglevel info" npm run tunnel
```

## Environment variables

- `HOST`: bind host, default `127.0.0.1` in development and `0.0.0.0` in production
- `PORT`: HTTP + WebSocket port, default `1234`
- `HTTP_KEEP_ALIVE_TIMEOUT_MS`: keep-alive timeout for HTTP sockets, default `5000`
- `HTTP_HEADERS_TIMEOUT_MS`: header read timeout, default `60000`
- `HTTP_REQUEST_TIMEOUT_MS`: full HTTP request timeout, default `30000`
- `WS_BASE_PATH`: WebSocket base path, default `/ws`
- `WS_HEARTBEAT_INTERVAL_MS`: heartbeat interval used to evict dead WebSocket clients, default `30000`
- `WS_MAX_BUFFERED_AMOUNT_BYTES`: buffered outbound bytes allowed per WebSocket before the server drops a slow client, default `1048576`
- `WS_MAX_PAYLOAD_BYTES`: maximum inbound WebSocket frame size, default `4194304`
- `PUBLIC_WS_BASE_URL`: optional public WebSocket URL override for reverse proxies
- `PERSISTENCE_DIR`: folder for persisted room state, default `data/rooms`
- `ROOM_NAMESPACE`: namespace used for persisted room keys, default `collabmd`
- `CLOUDFLARED_BIN`: `cloudflared` binary path, default `cloudflared`
- `TUNNEL_TARGET_HOST`: local host used by the tunnel helper, default `127.0.0.1`
- `TUNNEL_TARGET_PORT`: local port used by the tunnel helper, default `1234`
- `TUNNEL_TARGET_URL`: full local target URL override for the tunnel helper
- `CLOUDFLARED_EXTRA_ARGS`: extra arguments appended to `cloudflared tunnel`

Copy the example file when you want environment-based deployment settings:

```bash
cp .env.example .env
```

## Coolify / VPS deployment

This repo now ships with a Dockerfile, so Coolify can deploy it as a Docker-based service.

Recommended setup:

1. Use the included `Dockerfile`.
2. Expose port `1234` in Coolify.
3. Mount a persistent volume to `/app/data` so room state survives container restarts.
4. Run a single replica only. This server keeps room state in process and does not coordinate rooms across multiple instances.
5. Set `PUBLIC_WS_BASE_URL` only if your WebSocket endpoint differs from the app origin.

Suggested hardening for smaller VPS instances:

- Keep the default heartbeat and payload limits unless you have a concrete reason to raise them.
- Put Cloudflare, Caddy, or Nginx in front so repeated static asset requests are cached before they reach Node.
- Monitor container RSS and CPU after launch; room fan-out is mostly memory + network bound, not database bound.

Health check:

```text
/health
```

## Notes

- The app is still intentionally lightweight: there is no authentication, authorization, or database-backed tenancy layer yet.
- Room URLs use hash routing, so reverse proxies do not need special SPA rewrite rules.
