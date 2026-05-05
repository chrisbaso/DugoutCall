# DugoutCall

DugoutCall is an iOS 17+ baseball pitch-calling communication system for a coach iPhone and a catcher iPhone. The coach sends large-button pitch/location calls and push-to-talk control signals over the network. The catcher phone receives commands, speaks pitch calls with AVFoundation text-to-speech, and routes playback to the catcher's locally paired AirPods.

Repository: https://github.com/chrisbaso/DugoutCall

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/chrisbaso/DugoutCall)

> Use only where permitted by your league/state association. Game Mode is designed for one-way coach-to-catcher communication.

## Hardware Requirements

- Coach iPhone.
- Catcher iPhone.
- Catcher AirPods paired to the catcher iPhone.
- Optional coach AirPods for coach microphone input.

Two phones are required because AirPods are paired to one local Apple device at a time. The coach phone does not directly broadcast to the catcher's AirPods; DugoutCall sends room messages and live-audio signaling from the coach phone to the catcher phone, and the catcher phone plays audio through its own audio route.

## Project Layout

```text
DugoutCall/
  ios/
    Package.swift
    Sources/DugoutCall/
      App/
      Features/
        RoleSelection/
        Coach/
        Catcher/
        Pairing/
        Audio/
        Networking/
        Settings/
        Diagnostics/
      Models/
      Services/
    Tests/DugoutCallTests/
  server/
    package.json
    src/
      index.ts
      rooms.ts
      auth.ts
      websocket.ts
      signaling.ts
      types.ts
    tests/
```

## Server Setup

```bash
cd DugoutCall/server
npm install
npm run dev
```

The local server defaults to `http://localhost:8787`.
It also serves the PWA demo from the same origin, so desktop testing can open `http://localhost:8787`.

Endpoints:

- `GET /health`
- `POST /rooms`
- `POST /rooms/:code/join`
- WebSocket on the same host for room join, pitch relay, push-to-talk start/stop, and heartbeats.

Production notes:

- Run behind TLS and expose WebSockets as `wss://`.
- Set `DUGOUTCALL_TOKEN_SECRET` to a strong secret.
- Do not commit production secrets.
- Keep room TTL short with `ROOM_TTL_MS`.

## iOS Setup

1. Open `DugoutCall/ios/Package.swift` in Xcode 15 or newer.
2. Select an iOS 17+ simulator or physical device.
3. Run two app instances/devices: one coach and one catcher.
4. In Settings, set the server URL:
   - Simulator to host Mac: usually `http://localhost:8787`.
   - Physical devices: use your Mac's LAN IP, for example `http://192.168.1.20:8787`.
5. Coach creates a room.
6. Catcher joins with the six-digit code.

Microphone permission is required for coach push-to-talk. Real AirPods routing and microphone behavior require physical devices.

## Game Mode

Game Mode is the default and primary flow.

- Coach can send pitch calls.
- Coach can press and hold Talk.
- Catcher cannot talk back.
- Catcher has no keyboard, message composer, or player-to-coach signal UI.
- Catcher has only listen status, audio route display, and emergency disconnect.

Technical heartbeats and low-level connection maintenance are allowed, but DugoutCall does not show catcher acknowledgements or read receipts in Game Mode.

## PWA Two-Phone Demo

The web demo can run as a real two-phone PWA without a Mac.

1. Start the server:

   ```bash
   cd DugoutCall/server
   npm run dev
   ```

2. Expose it over HTTPS for iPhone microphone access. Options include Cloudflare Tunnel, ngrok, or another HTTPS reverse proxy.
3. Coach opens the HTTPS URL in Safari, taps Coach Mode, and creates a room.
4. Catcher opens the same HTTPS URL in Safari, taps Catcher Mode, and joins with the six-digit code.
5. Catcher connects AirPods to the catcher iPhone.
6. Catcher taps Play test audio once if iOS has not unlocked audio playback.
7. Coach sends pitch calls or presses and holds Talk.
8. In Safari, use Share > Add to Home Screen to install the PWA-style launcher.

Important PWA notes:

- iPhone microphone access requires HTTPS or localhost. A LAN URL like `http://192.168.x.x:8787` can show the UI and relay pitch calls, but push-to-talk microphone access may be blocked by the browser.
- WebRTC live audio uses STUN by default. Same-Wi-Fi demos are the easiest path. Some networks require a TURN server for reliable audio.
- The PWA cannot force AirPods routing; connect AirPods to the catcher iPhone before joining.
- Game Mode remains one-way. Catcher-originated WebRTC answer and ICE messages are technical transport only and are not exposed as a player feedback feature.

## Hosted Field Demo

For use at a separate field without a laptop, deploy DugoutCall as a hosted HTTPS service. The included `Dockerfile` and `render.yaml` are set up for Render.

Fastest path:

1. Open the Deploy to Render button above, or go to https://render.com/deploy?repo=https://github.com/chrisbaso/DugoutCall.
2. Connect the GitHub repo: `chrisbaso/DugoutCall`.
3. Let Render use the included `render.yaml`.
4. Keep the instance type on Free for no monthly charge, or upgrade later if you need it awake all the time.
5. Deploy the web service.
6. Open the Render HTTPS URL on both iPhones.

Render deployment:

1. Push this `DugoutCall` folder to GitHub.
2. In Render, create a new Blueprint or Docker Web Service from the repo.
3. Use the included `render.yaml`, or configure:
   - Dockerfile: `./Dockerfile`
   - Health check path: `/health`
4. Set environment variables:
   - `DUGOUTCALL_TOKEN_SECRET`: a long random secret.
   - `ROOM_TTL_MS`: `7200000` for two-hour rooms.
   - `DUGOUTCALL_ICE_SERVERS`: JSON array of WebRTC ICE servers.

Default ICE server config:

```json
[{"urls":"stun:stun.l.google.com:19302"}]
```

More reliable field/cellular voice usually needs TURN. Example shape:

```json
[
  {"urls":"stun:stun.l.google.com:19302"},
  {
    "urls":["turn:your-turn-host.example.com:3478"],
    "username":"your-username",
    "credential":"your-password"
  }
]
```

After deployment:

1. Coach opens the hosted HTTPS URL on an iPhone.
2. Catcher opens the same hosted HTTPS URL on a second iPhone.
3. Catcher connects AirPods.
4. Coach creates a room.
5. Catcher joins with the six-digit room code.
6. Coach sends pitch calls or holds Talk.

No laptop is needed at the field after the service is deployed.

Free hosting note: the default Blueprint uses Render's Free instance type. It can sleep after idle time, so open the app a minute before a demo or game test to wake it up. For more reliable live use, switch the Render service to a paid instance.

## Vercel Deployment

Vercel is a good fit for hosting the PWA front-end, but the current DugoutCall backend uses a long-lived WebSocket server for rooms and WebRTC signaling. Vercel Functions are not the right place for that server. Use Vercel for the web app and host the backend on Render, Fly.io, Railway, or another Node host that supports persistent WebSockets.

Recommended split:

```text
Vercel:  PWA static web app
Backend: Node/WebSocket server on Render/Fly/Railway
Phones:  Open the Vercel HTTPS URL
```

Vercel setup:

1. Deploy the backend first and confirm it has an HTTPS URL, for example `https://dugoutcall-backend.onrender.com`.
2. Push this repo to GitHub.
3. Import the project into Vercel.
4. Set the project root to this `DugoutCall` folder.
5. Add this environment variable in Vercel:

   ```text
   DUGOUTCALL_PUBLIC_SERVER_URL=https://your-backend-host.example.com
   ```

6. Deploy. Vercel runs `npm run vercel-build`, which writes `demo-web/runtime-config.js`.

Local Vercel-style build:

```bash
cd DugoutCall
$env:DUGOUTCALL_PUBLIC_SERVER_URL="https://your-backend-host.example.com"
npm run vercel-build
```

If `DUGOUTCALL_PUBLIC_SERVER_URL` is blank, the PWA uses the same origin. That is useful for local development and Render's all-in-one deployment, but not for Vercel unless the backend is hosted separately.

## Practice Mode

Practice Mode is present as a settings/admin toggle for future testing workflows. The MVP still does not enable catcher talkback.

## Current MVP Behavior

- Room creation and join code flow.
- One coach and one catcher per room.
- Expiring room codes.
- Per-room signed tokens from HTTP endpoints.
- WebSocket pitch command relay from coach to catcher.
- Catcher TTS playback with speech rate and volume settings.
- Repeat Last, Clear, presets, pitch grid, and location grid.
- Compact mobile coach grid with sticky Send/Repeat/Clear/Talk controls.
- Compact default pitch set: Fastball, Curveball, and Change-up.
- Per-device PWA customization for pitch button labels and preset buttons, stored locally in the browser.
- AVAudioSession configuration for coach push-to-talk and catcher playback.
- Push-to-talk start/stop signaling is implemented. A production live voice stream should connect `PushToTalkService` to a WebRTC or LiveKit media transport before game use.
- PWA push-to-talk uses browser WebRTC media with WebSocket signaling. Native SwiftUI push-to-talk still needs the iOS media transport adapter.

## Testing

Server:

```bash
cd DugoutCall/server
npm test
npm run build
```

iOS model tests:

```bash
cd DugoutCall/ios
swift test
```

`swift test` and simulator builds require macOS/Xcode. This workspace was generated on Windows, so native iOS compilation must be verified on a Mac.

## Manual Test Checklist

1. Coach creates room.
2. Catcher joins.
3. Catcher AirPods connected.
4. Coach sends Fastball Away.
5. Catcher hears "Fastball away."
6. Coach presses and holds Talk.
7. Catcher hears coach voice after WebRTC/LiveKit media transport is configured.
8. Coach releases Talk.
9. Voice stops.
10. Catcher cannot talk back in Game Mode.
11. AirPods disconnect warning appears.
12. Reconnect works.

## Known Limitations

- AirPods must be connected to the receiving catcher device.
- Bluetooth route can change if AirPods auto-switch to another Apple device.
- Cellular or Wi-Fi quality affects live voice latency.
- League rules vary; users must verify legality before game use.
- DugoutCall is not a certified officiating or legal compliance product.
- MVP does not support multiple catchers or pitcher receivers.
- MVP does not support Android.
- Live voice needs a WebRTC or LiveKit media adapter wired into `PushToTalkService` before production game use.

## Future Features

- LiveKit or WebRTC one-way media transport implementation.
- QR scanner join flow.
- Reconnect backoff and room recovery UI.
- Optional local-only pitch history, off by default.
- Admin-only Practice Mode testing controls.
- Deployment templates for a TLS/WSS backend.
