# Native iOS Rescope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DugoutCall a native SwiftUI iOS field app, with the Node backend limited to room pairing, pitch-message relay, and optional push-to-talk signaling.

**Architecture:** The native app owns the full coach/catcher experience, audio session behavior, AirPods route monitoring, speech playback, and one-way Game Mode UX. The backend remains a lightweight stateless-ish room service with expiring rooms, per-room tokens, WebSocket relay, and WebRTC/LiveKit signaling passthrough. `demo-web/` is retained only as a backend development harness.

**Tech Stack:** SwiftUI, Swift concurrency, AVFoundation, URLSession, URLSessionWebSocketTask, Node.js, Express, ws, TypeScript, Vitest.

---

### Task 1: Native-First Product Contract

**Files:**
- Modify: `README.md`
- Modify: `ios/Sources/DugoutCall/Models/CoreModels.swift`
- Modify: `ios/Sources/DugoutCall/Features/Coach/PitchGridView.swift`
- Test: `ios/Tests/DugoutCallTests/PitchCallTests.swift`
- Test: `ios/Tests/DugoutCallTests/PresetTests.swift`

- [x] **Step 1: Demote PWA to development harness**

Rewrite README wording so the production client is the native SwiftUI app and the hosted web app is explicitly non-production.

- [x] **Step 2: Align field vocabulary**

Set the pitch grid to Fastball, Curveball, and Change-up. Keep Pitchout and Pickoff as special preset calls.

- [x] **Step 3: Update native tests**

Update phrase and preset tests so Swift models match the field vocabulary.

- [ ] **Step 4: Verify on macOS**

Run:

```bash
cd ios
swift test
```

Expected: all `DugoutCallTests` pass.

### Task 2: Native Room And Socket Contract

**Files:**
- Modify: `ios/Sources/DugoutCall/Services/RoomService.swift`
- Modify: `ios/Sources/DugoutCall/Services/WebSocketService.swift`
- Modify: `server/src/websocket.ts`
- Test: `server/tests/websocket.test.ts`

- [ ] **Step 1: Keep HTTP and WebSocket identity consistent**

Native app should use the same display name for HTTP room join and WebSocket room attach. Coach uses `Coach`; catcher uses `Catcher`.

- [ ] **Step 2: Verify catcher socket attach after HTTP join**

Run:

```bash
npm test --prefix server
```

Expected: the WebSocket regression test for post-HTTP catcher attach passes.

### Task 3: Native Push-To-Talk Media Adapter

**Files:**
- Modify: `ios/Sources/DugoutCall/Services/PushToTalkService.swift`
- Create: `ios/Sources/DugoutCall/Services/LiveAudioTransport.swift`
- Modify: `ios/Sources/DugoutCall/Features/Coach/PushToTalkButton.swift`
- Modify: `ios/Sources/DugoutCall/Features/Catcher/CatcherReceiverView.swift`

- [ ] **Step 1: Define the transport protocol**

Create a Swift protocol with `startTransmitting(room:token:)`, `stopTransmitting()`, `startReceiving(room:token:)`, and `stopReceiving()`.

- [ ] **Step 2: Wire PushToTalkService to the protocol**

Coach press-and-hold starts/stops one-way audio transport. Game Mode must not expose catcher talkback.

- [ ] **Step 3: Add LiveKit or WebRTC implementation**

Use the backend WebSocket only for signaling/token exchange. Do not record audio by default.

### Task 4: Native Field Hardening

**Files:**
- Modify: `ios/Sources/DugoutCall/Services/AudioSessionService.swift`
- Modify: `ios/Sources/DugoutCall/Services/AudioRouteMonitor.swift`
- Modify: `ios/Sources/DugoutCall/Features/Diagnostics/AudioDiagnosticsView.swift`
- Modify: `ios/Sources/DugoutCall/Features/Catcher/CatcherReceiverView.swift`

- [ ] **Step 1: Configure coach audio session**

Use `playAndRecord`, Bluetooth options, and microphone permission checks when push-to-talk begins.

- [ ] **Step 2: Configure catcher audio session**

Use playback-only mode and surface AirPods route warnings before Game Mode.

- [ ] **Step 3: Verify physical device behavior**

On two iPhones, verify AirPods routing, route-change warnings, phone-call interruptions, and foreground/background recovery.
