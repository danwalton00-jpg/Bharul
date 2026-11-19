# Bharul

A Safari- and Edge-adaptive Progressive Web App starter for local camera and media preview.

## Run locally

Camera access requires HTTPS, except on localhost. From this folder run:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in Safari or Edge.

## Deploy

Upload the contents of this folder to an HTTPS host. Installability and service-worker caching require HTTPS (localhost is allowed for development).

## Implemented

- Official app branding: Bharul.
- Browser and iOS-device detection for Safari/Edge and other browsers.
- Capability checks for secure context, camera API, WebRTC, MediaRecorder, and camera permission state where exposed.
- User-initiated front/rear camera access through `getUserMedia()`.
- Local camera video recording with MediaRecorder, stop controls, and a downloadable recording when supported by the browser.
- A pose and camera checklist assistant that turns a written shot request into practical framing and recording steps.
- Local photo, video, and audio selection and preview.
- Responsive PWA manifest, SVG app icon, and service-worker shell caching.
- Clear limitations and recovery guidance; no simulated calling controls.

## Not implemented yet

- Real one-to-one voice/video calling using the deployed WebSocket signaling service and WebRTC. Calls require both people to keep the page open and grant camera/microphone access. STUN is configured; a TURN relay is recommended for restrictive networks. Incoming/background call notifications have additional browser and iOS restrictions.
- AI image/video analysis or automatic pose editing. The included pose assistant creates a local filming checklist only; real AI analysis/editing requires a separately configured AI provider and secure server-side API key.
- Persistent server media upload, user accounts, encrypted messaging, and group chat. Media remains local to the browser until a separately configured persistent storage provider and access controls are added.
- Replacing another website's camera feed or controlling another tab. Ordinary Safari/Edge pages are isolated by browser security and cannot do this.

## Privacy and compatibility

Camera permission is requested only after the user presses Start camera. Files are previewed locally using object URLs; this starter does not upload them. Browser support varies by iOS version, browser engine, media codec, and hosting configuration. Safari and Edge on iOS share Apple's WebKit engine and do not gain unrestricted native iOS calling APIs.


## AI image editing setup

Bharul can send a user-selected photo or still frame to the OpenAI Images Edits API. The API key is read only by the server; never place it in frontend JavaScript. Deploy the updated `server.js`, `package.json`, `index.html`, `app.js`, and `styles.css` together. The service uses Node.js 20+ and installs `busboy` for bounded multipart uploads.

In Render, open the `bharul-call-server` service, go to **Environment**, and add `OPENAI_API_KEY` with your OpenAI API key. Optionally set `OPENAI_IMAGE_MODEL` (default: `gpt-image-2.5-sunburst`). Save changes and redeploy. API usage is billed separately by the AI provider; Render Free hosting does not include AI API credits.

The `/ai/edit-image` endpoint accepts one JPG, PNG, or WEBP image up to 10 MB and a prompt up to 2,000 characters. It checks the same-origin allowlist, applies a basic per-IP rate limit, and returns the generated image. For video uploads, the browser extracts a single frame and edits that still image; it does not create a new video. This starter has no user login, so add authenticated access and stronger distributed abuse controls before exposing AI editing publicly.
