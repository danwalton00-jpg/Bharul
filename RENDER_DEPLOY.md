# Deploy Bharul on Render

This project uses **one Render Node web service on the Free plan** to serve the Bharul PWA and its WebSocket signaling endpoint from the same HTTPS origin. Render terminates TLS and supports WebSocket connections.

## Blueprint

- Blueprint file: `render.yaml`
- Service: `bharul-call-server`
- Runtime: Node.js
- Build: `npm install --omit=dev`
- Start: `npm start`
- Health check: `/health`
- WebSocket endpoint: `wss://bharul-call-server.onrender.com/signal`
- ICE configuration: `https://bharul-call-server.onrender.com/ice-config`

The `config.js` derives the secure WebSocket URL from the deployed page's own hostname, so the app and signaling service stay aligned when a custom domain is added.

## Deploy steps

1. Put this project directory's contents at the root of a GitHub repository (including `render.yaml`).
2. Sign in to Render and choose **New → Blueprint**.
3. Connect the GitHub repository containing `render.yaml` and select **Apply** / **Deploy Blueprint**.
4. In the new service's **Environment** page, add TURN provider values for `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL`. These are private server-side secrets; never put them in `config.js`, Git, or the browser.
5. Wait for the deploy to become **Live**, then open `https://bharul-call-server.onrender.com`.
6. Test with two separate devices/browsers. Create a room on one device, share the room code privately, and join on the other device. Grant camera and microphone permission on both.

## Custom domain

If you attach a custom domain to the Render service, update `ALLOWED_ORIGIN` to that exact origin, e.g. `https://your-domain.example` (scheme included, no path or trailing slash). If both the Render subdomain and custom domain should work, set `ALLOWED_ORIGINS` to a comma-separated list of exact origins and remove/replace `ALLOWED_ORIGIN`.

## Free-plan limitations

- Free web services spin down after 15 minutes without an inbound HTTP request or a WebSocket message from an existing connection. The first request or new WebSocket connection wakes the service; Render says startup takes about one minute. A live WebSocket connection that continues exchanging messages can keep the service active, but a quiet/idle room may still be interrupted.
- Free instances can be restarted by Render, have limited compute, and have an ephemeral filesystem. Do not store user uploads or important data on the service filesystem.
- Render describes Free instances as suitable for testing and hobby projects, not production applications. For dependable always-on calling, use a paid always-on web service.
- The Render deployment is not performed by generating this package. You must connect your Render account and Git repository and approve deployment in Render.
- STUN alone does not guarantee connections across restrictive NATs. Supply valid TURN credentials from a TURN provider for reliable call connectivity.
- This package still does not provide user accounts, authenticated room tokens, end-to-end identity verification, group calling, or native iOS background-call integration. Do not use it as a public production communications platform until those controls are implemented and reviewed.
