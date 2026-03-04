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

- Node.js 18+
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
npm run tunnel
npm run start:tunnel
```

`npm start` always rebuilds the browser bundle before starting the server. `npm run start:prod` expects a previous `npm run build`.

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
- `WS_BASE_PATH`: WebSocket base path, default `/ws`
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
4. Set `PUBLIC_WS_BASE_URL` only if your WebSocket endpoint differs from the app origin.

Health check:

```text
/health
```

## Notes

- The app is still intentionally lightweight: there is no authentication, authorization, or database-backed tenancy layer yet.
- Room URLs use hash routing, so reverse proxies do not need special SPA rewrite rules.
