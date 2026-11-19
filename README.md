# Bharul

Safari/Edge-first PWA with local media preview and a one-to-one WebRTC calling client plus a separate WebSocket signaling service.

## Local preview

Run `python3 -m http.server 8000` from this directory and open `http://localhost:8000`. Camera/microphone permissions require HTTPS except localhost.

## Deploy the signaling backend

1. Deploy this directory to a Node.js 20+ host or Docker host. The service listens on `PORT` (default 8080).
2. Set `NODE_ENV=production` and `ALLOWED_ORIGIN` to the exact HTTPS origin serving Bharul (scheme and hostname, optional port, no path or trailing slash). Production startup intentionally rejects WebSocket connections if the allowlist is missing.
3. Configure `STUN_URLS`. For dependable connections across carrier NATs and restrictive networks, obtain TURN URLs, username, and credential from a trusted TURN provider. Store TURN secrets only as server environment variables; never put them in `config.js` or frontend code.
4. Put the backend behind HTTPS/WSS using the host's TLS/reverse proxy. Forward `/health`, `/ice-config`, and WebSocket upgrades to the service.
5. Edit `config.js` and set `window.BHARUL_SIGNAL_URL` to the secure WebSocket endpoint, e.g. `wss://calls.your-domain.example`. The client fetches ICE settings from the matching HTTPS `/ice-config` endpoint.
6. Deploy the web app on HTTPS. Open Bharul on two devices/browsers, create a room, share the room code privately, and join from the second device. Both users must grant microphone/camera access.

## Docker

Copy `.env.example` to `.env`, replace all example values with real provider values, then run `docker compose up -d --build`. Configure a TLS reverse proxy to forward HTTPS and WebSocket traffic to port 8080. Do not expose the service directly over public HTTP.

## Security status

The sample signaling service enforces a strict origin allowlist in production, limits connections per IP and messages per connection, restricts signaling message types and payload sizes, disables WebSocket compression, and limits rooms to two peers. These are baseline protections, not a substitute for production identity and authorization. Before public launch add authenticated users, short-lived signed room-join tokens, persistent distributed rate limits, abuse reporting/moderation, monitoring, TURN credential rotation, privacy/retention policies, and a security review. Room codes alone are not authentication. HTTPS/WSS and TURN provider credentials are still deployment prerequisites. Incoming/background iOS calls and PushKit/CallKit integration are not provided by a Safari PWA.

## Included

- User-initiated camera and microphone permission requests.
- One-to-one WebRTC audio/video peer connection and WebSocket offer/answer/ICE signaling.
- Room creation/joining, mute, camera toggle, and end call.
- Signaling health endpoint and server-provided ICE configuration.
- Local photo/video/audio preview, PWA shell, and browser diagnostics.

## Not included

Group calls, user accounts, message history, server-side media upload, end-to-end identity verification, AI analysis, native iOS background calling, or control of another browser tab.

## Render deployment

See `RENDER_DEPLOY.md` and the root `render.yaml`. Render serves the app and WebSocket signaling from the same service; `config.js` automatically uses the current HTTPS hostname and `/signal` WSS endpoint. Add TURN provider secrets in the Render dashboard before testing calls across different networks.


## Render Free plan

The included `render.yaml` selects Render Free for testing. Free services can spin down after 15 minutes without inbound HTTP or existing-WebSocket messages and may take about a minute to wake. Treat this as a test deployment, not reliable always-on calling. See `RENDER_DEPLOY.md` for limits and deployment steps.
