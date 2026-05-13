# DugoutCall

DugoutCall is a native SwiftUI iOS 17+ baseball pitch-calling communication system for a coach iPhone and a catcher iPhone. The coach uses large game-day buttons and press-and-hold talk controls. The catcher phone receives one-way pitch calls and coach voice, then plays audio through the catcher's locally paired AirPods.

Repository: https://github.com/chrisbaso/DugoutCall

[![Deploy Backend to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/chrisbaso/DugoutCall)

> Use only where permitted by your league/state association. Game Mode is designed for one-way coach-to-catcher communication.

## Product Scope

DugoutCall is no longer scoped as a production web app. The production client is the native SwiftUI iOS app in `ios/`.

The backend is intentionally lightweight:

- Create and expire rooms.
- Issue per-room coach/catcher tokens.
- Relay pitch-call JSON messages.
- Relay WebRTC/LiveKit push-to-talk signaling.
- Provide health/config endpoints.

The `demo-web/` PWA remains in the repo only as a development harness for backend, room, and signaling experiments. It is not the product experience and should not drive UI or field-use decisions.

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

The local server defaults to `http://localhost:8787`. Native iOS clients should point Settings at this server URL during development.

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

### Expo/TestFlight Path

For a no-Mac publishable iPhone build, use the Expo app in `mobile/`.

```bash
cd DugoutCall/mobile
npm install
npm run start
```

For TestFlight:

```bash
cd DugoutCall/mobile
eas init
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

The Expo app uses bundle identifier `com.chrisbaso.dugoutcall` and defaults to the hosted backend at `https://dugoutcall.onrender.com`.

Current Expo MVP supports room creation/joining, pitch button relay, catcher listen-only mode, and text-to-speech playback. The Hold Talk control currently sends push-to-talk signaling; live voice streaming requires the next native media adapter step.

### SwiftUI Reference Path

1. Open `DugoutCall/ios/Package.swift` in Xcode 15 or newer.
2. Select an iOS 17+ simulator or physical device.
3. Run two app instances/devices: one coach and one catcher.
4. In Settings, set the server URL:
   - Simulator to host Mac: usually `http://localhost:8787`.
   - Physical devices: use your Mac's LAN IP, for example `http://192.168.1.20:8787`.
5. Coach creates a room.
6. Catcher joins with the six-digit code.

Microphone permission is required for coach push-to-talk. Real AirPods routing and microphone behavior require physical devices.

Native field-use priorities:

- Coach screen must be usable one-handed between pitches.
- Pitch grid defaults to Fastball, Curveball, and Change-up.
- Pitchout and Pickoff are special one-tap calls, not normal pitch-grid clutter.
- Catcher screen is locked listen-only in Game Mode.
- AirPods must be paired to the catcher iPhone.
- Live voice is one-way only in Game Mode.

## Game Mode

Game Mode is the default and primary flow.

- Coach can send pitch calls.
- Coach can press and hold Talk.
- Catcher cannot talk back.
- Catcher has no keyboard, message composer, or player-to-coach signal UI.
- Catcher has only listen status, audio route display, and emergency disconnect.

Technical heartbeats and low-level connection maintenance are allowed, but DugoutCall does not show catcher acknowledgements or read receipts in Game Mode.

## Web Harness

The web app is a development harness, not the production target. Use it only to smoke-test backend room pairing, pitch relay, and browser WebRTC experiments when a Mac/Xcode device setup is not available.

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
Important web harness notes:

- iPhone microphone access requires HTTPS or localhost. A LAN URL like `http://192.168.x.x:8787` can show the UI and relay pitch calls, but push-to-talk microphone access may be blocked by the browser.
- WebRTC live audio uses STUN by default. Same-Wi-Fi demos are the easiest path. Some networks require a TURN server for reliable audio.
- A browser cannot provide the same AirPods/audio-session control as native iOS.
- Game Mode remains one-way. Catcher-originated WebRTC answer and ICE messages are technical transport only and are not exposed as a player feedback feature.

## Hosted Field Demo

For native iOS use away from a laptop, deploy the lightweight backend as a hosted HTTPS/WSS service. The included `Dockerfile` and `render.yaml` are set up for Render.

Fastest path:

1. Open the Deploy to Render button above, or go to https://render.com/deploy?repo=https://github.com/chrisbaso/DugoutCall.
2. Connect the GitHub repo: `chrisbaso/DugoutCall`.
3. Let Render use the included `render.yaml`.
4. Keep the instance type on Free for no monthly charge, or upgrade later if you need it awake all the time.
5. Deploy the web service.
6. Put the Render HTTPS URL into Settings on both native iOS apps.

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

1. Coach opens the native iOS app.
2. Catcher opens the native iOS app on a second iPhone.
3. Both apps use the hosted backend URL in Settings.
4. Catcher connects AirPods to the catcher iPhone.
5. Coach creates a room.
6. Catcher joins with the six-digit room code.
7. Coach sends pitch calls or holds Talk.

No laptop is needed at the field after the service is deployed.

Free hosting note: the default Blueprint uses Render's Free instance type. It can sleep after idle time, so open the app a minute before a demo or game test to wake it up. For more reliable live use, switch the Render service to a paid instance.

## Web Hosting Non-Goal

Do not optimize DugoutCall around Vercel/PWA deployment. If the web harness is hosted, it is only for internal testing. Production field use should be native iOS plus the hosted backend.

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
- Native SwiftUI coach grid optimized around Fastball, Curveball, and Change-up.
- Pitchout and Pickoff remain one-tap presets.
- AVAudioSession configuration for coach push-to-talk and catcher playback.
- Push-to-talk start/stop signaling is implemented. A production live voice stream should connect `PushToTalkService` to a WebRTC or LiveKit media transport before game use.
- Native SwiftUI push-to-talk still needs the iOS WebRTC or LiveKit media transport adapter.

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
