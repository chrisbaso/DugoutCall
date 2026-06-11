# DugoutCall — Full Senior Review

**Audited commit:** `fed3905` (branch `main`)
**Scope:** `server/` (Node relay), `ios/` (native SwiftUI app — the stated production client), `mobile/` (Expo app, shipping to TestFlight), `demo-web/` (dev harness), deploy configs, CI, git history.
**Operating context:** weak/spotty ballfield cellular, 2+ hour sessions, one-handed use under time pressure between pitches.

---

## Executive summary — findings ranked by severity

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| 1 | **Critical** | Native iOS app transmits **no live voice at all** — there is no LiveKit/WebRTC dependency in `ios/Package.swift`; "Hold to Talk" only sends `ptt_start`/`ptt_stop` signals. The catcher shows "Receiving voice" and hears nothing. | `ios/Package.swift`, `PushToTalkService.swift` |
| 2 | **Critical** | Relay accepts WebSocket `join_room` with **no token verification**. Anyone with (or brute-forcing) the 6-digit code can join as **coach** (inject fake pitch calls) or **catcher** (eavesdrop every call live). The signed tokens the server issues are never checked anywhere. | `server/src/websocket.ts:56-77` |
| 3 | **Critical** | iOS app has **zero reconnect logic**. One dropped packet kills the receive loop permanently; calls sent while offline silently vanish (`task?.send` no-ops when `task` is nil); all send errors are swallowed with `try?`. On a ballfield this fails within minutes. | `ios/Sources/DugoutCall/Services/WebSocketService.swift` |
| 4 | **Critical** | Relay restart loses every active room (in-memory `Map`), and the recommended deployment is **Render free tier, which sleeps mid-game** (`render.yaml: plan: free`). No recovery path: rejoin returns "Room not found" and the game is over. | `server/src/rooms.ts`, `render.yaml` |
| 5 | **High** | Coach UI lies about delivery: banner hardcodes the string `"Catcher connected"`, `connectionState` is set to `.connected` before the socket actually opens, and there is no delivered/failed feedback for any call. | `CoachDashboardView.swift:120`, `WebSocketService.swift:25` |
| 6 | **High** | iOS suspension is unhandled: no `scenePhase` observation, no background audio mode, no idle-timer override. Catcher's phone locks → app suspends → socket dies → all subsequent calls are missed with no indication on either phone. | `DugoutCallApp.swift`, `Info.plist` |
| 7 | **High** | INTEGRATION_API.md **does not exist** in the repo or its git history. The iOS client implements no Bearer-token auth, no `Authorization` header, no HTTP status handling, no retry. The scouting-platform integration is not started. | `ios/Sources/DugoutCall/Services/RoomService.swift` |
| 8 | **High** | Unauthenticated `/rooms/:code/diagnostics` leaks live pitch calls (`spokenText`), roles, and display names to anyone with the room code — a real-time sign-stealing API. | `server/src/index.ts:115-124`, `diagnostics.ts` |
| 9 | **High** | Push-to-talk race can leave the coach **stuck transmitting**: rapid press/release runs `stop()` before `start()` completes; `stop()`'s `guard isTransmitting` returns early, then `start()` finishes and sets `isTransmitting = true` forever. | `PushToTalkButton.swift`, `PushToTalkService.swift` |
| 10 | **Medium** | Token secret falls back to `'local-development-secret-change-me'` in production if the env var is unset; no fail-fast. LiveKit env vars are absent from `render.yaml`, so blueprint deploys silently disable voice. | `server/src/index.ts:15`, `render.yaml` |
| 11 | **Medium** | No rate limiting anywhere: room-code brute force (1M space ÷ unlimited tries), unbounded room creation (memory DoS), wide-open CORS. | `server/src/index.ts` |
| 12 | **Medium** | Room TTL is 2 h and games run 2+ h; rooms expire mid-game with no warning, no extension path, and no `room_closed` notification (the message type exists but is never sent). | `rooms.ts`, `types.ts:66` |
| 13 | **Medium** | ATS will block the documented LAN setup: README tells devs to use `http://192.168.x.x:8787`, but `Info.plist` has no `NSAllowsLocalNetworking`/ATS exception, so cleartext LAN requests fail on device. | `Info.plist`, `README.md` |
| 14 | **Low** | Server diagnostics maps grow unboundedly across room codes (never pruned); `cleanupExpired` only runs on room creation; relay has no WS ping so dead sessions linger in the relay loop. | `diagnostics.ts`, `rooms.ts`, `websocket.ts` |
| 15 | **Low** | No secrets committed to the repo or its history (verified: only `devsecret`/`devkey` test placeholders in `auth.test.ts`). `.env` is gitignored; `render.yaml` generates the secret. This area is in good shape. | — |

---

## 1. Real-time reliability under bad networks (the core promise)

This is the weakest part of the product. The native iOS app, the stated production client, would not survive one inning on spotty cellular.

### 1.1 No reconnect logic of any kind — Critical
`WebSocketService.receiveLoop()` (`WebSocketService.swift:47-61`) recurses on success and, on the first failure, sets `connectionState = .disconnected` and stops. Nothing ever restarts it. There is no backoff, no retry, no automatic re-`join_room`, and no UI affordance to reconnect — `CoachDashboardView` has `navigationBarBackButtonHidden()` and **no leave/reconnect button at all**, so the coach's only recovery is force-killing the app and recreating the room (new code, re-pair the catcher). A single radio handoff between cell towers ends the session.

The Expo app (`mobile/App.tsx`) is the same: `socket.onclose` just sets state to `disconnected`. Its only resilience is HTTP retry-with-backoff in `requestJson` (lines 340-363, for waking the Render free instance) and whatever the LiveKit client SDK does internally (LiveKit does auto-reconnect, which is why voice is the *most* reliable channel in the Expo build while pitch calls are the least).

### 1.2 Connection state is a guess, not a fact — Critical
`connect()` sets `connectionState = .connected` immediately after `task.resume()` (`WebSocketService.swift:25`) — before the TCP/TLS/WS handshake completes. No `URLSessionWebSocketDelegate` (`didOpenWithProtocol` / `didCloseWith`) is used. The coach can see "Connected" and send calls into a socket that never opened. Conversely, after NAT timeout on idle cellular, the state stays "Connected" until the *next* receive fails — and since the catcher never sends anything to the coach in Game Mode, the coach's dead socket can go undetected indefinitely. The server supports `heartbeat` round-trips, but the iOS client never sends one (`DugoutMessage.heartbeat` is defined and unused).

### 1.3 Calls vanish silently when offline — Critical
Three layers of silent loss compound:
- `WebSocketService.send` is `try await task?.send(...)` — if `task` is nil (after `disconnect()`), the optional chain **no-ops and returns success**.
- Every call site swallows errors: `try? await pitchService.send(...)` in `CoachDashboardView.swift:31,68,92`.
- `PitchCallService` has no outbound queue (the existing `queuedCall` is only the one-slot defer-during-PTT buffer; a second queued call overwrites the first silently — `PitchCallService.swift:20-27`).

Net effect: coach taps "Curve Down" during a drop, sees no error, the catcher hears nothing, and the pitch gets crossed up. This is the exact failure the product exists to prevent.

### 1.4 No delivery confirmation end-to-end — High
The server already computes `recipientCount` for every relayed pitch call (`websocket.ts:109`) but only writes it to diagnostics — it never acks the coach. The "no catcher acknowledgements" Game Mode rule (README) is about not exposing *catcher-originated* signals; a *server-side* delivery receipt ("relayed to 1 catcher socket") would not violate it and is the single highest-value reliability feature missing.

### 1.5 Recovery without restarting the session — Critical (absent)
There is no session-recovery story:
- Client side: nothing rejoins after a drop (1.1).
- Server side: rooms are in-memory only; a relay restart or Render free-tier sleep wipes them (see §2.5).
- The signed room token (which encodes `roomCode`, `role`, `expiresAt` under HMAC) is the obvious recovery credential — the client holds it (`Room.token`) but never uses it, and the server never accepts it.

### 1.6 LiveKit connection handling — split verdict
- **Native iOS:** no LiveKit at all (Critical, finding #1). `CreateRoomResponse`/`JoinRoomResponse` don't even decode the `livekit` field the server returns. README confirms: "Native SwiftUI push-to-talk still needs the iOS WebRTC or LiveKit media transport adapter."
- **Expo app:** reasonable. It connects with role-scoped tokens, surfaces `Reconnecting`/`SignalReconnecting` states ("LiveKit reconnecting..."), disables coach mic on connect, and relies on LiveKit's built-in reconnection. Gaps: if the initial `connect()` fails there is no retry (one-shot at room join, `App.tsx:746`); a LiveKit `Disconnected` event is recorded in diagnostics but triggers no rejoin; and the legacy raw-WebRTC path (STUN-only, no TURN) coexists with LiveKit and still handles `webrtc_offer`/`answer` messages, which is dead weight and a second failure surface.

---

## 2. The Node relay

### 2.1 Authentication: effectively none — Critical
- **WebSocket:** `join_room` (`websocket.ts:56`) calls `rooms.joinRoom()` with whatever role the client claims. The `token?` field exists in the `ClientMessage` type (`types.ts:52`) and is **never read**. Consequences:
  - Join as `catcher` → if the slot is taken, `joinRoom` throws — but if the legit catcher hasn't attached yet (or the attacker sends `displayName: "Catcher"`, matching the hardcoded client name, `rooms.ts:68`), the attacker takes/duplicates the slot and **hears every pitch call live**.
  - Join as `coach` → `joinRoom` returns the *existing* coach participant (`rooms.ts:62-66`) and the socket session is tagged `role: 'coach'`. The attacker now **receives coach-bound relays and can inject pitch calls** that the catcher's phone speaks aloud. Nothing distinguishes the real coach's socket.
- **HTTP:** `POST /rooms/:code/join` requires only the code (acceptable for first join, but it also mints LiveKit listen tokens — combined with no rate limiting, see 2.4). `GET /rooms/:code/diagnostics` requires only the code and leaks call contents (finding #8).
- The HMAC room tokens (`auth.ts`) are well-implemented — timing-safe compare, expiry check, role whitelist — and **verifyRoomToken is called from exactly one place: the test suite**. The lock exists; no door uses it.

### 2.2 LiveKit token generation and expiry — Good, with caveats
`createLiveKitVoiceToken` (`auth.ts:39-75`) is the best code in the relay: role-scoped grants (coach: publish mic only; catcher: subscribe only; `canPublishData: false`), TTL clamped to room expiry. Caveats:
- TTL is up to 2 h with no refresh path; combined with the 2 h room TTL, voice dies mid-game with no recovery (finding #12).
- Anyone who passes the unauthenticated HTTP join gets a valid LiveKit subscribe token — LiveKit security is only as good as the join gate, which is currently the guessable code.
- `render.yaml` omits `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, so the one-click deploy ships with voice silently disabled (`createLiveKitVoiceToken` returns `null`, Expo client shows "LiveKit not configured").

### 2.3 Room lifecycle cleanup — Medium
- `cleanupExpired()` runs **only inside `createRoom`** (`rooms.ts:22`) — a relay hosting one long game never sweeps.
- `closeRoom()` exists and is never called by any endpoint; there is no coach-initiated "end game".
- `room_closed` is in the server message union (`types.ts:66`) and is never emitted; clients can't distinguish expiry from network loss.
- Expired rooms reject *new* joins but **existing sockets keep relaying forever** — the session map is never checked against room expiry, so a "2-hour room" actually relays until both sockets die.
- `RoomDiagnostics` maps (`events`, `counters`) are keyed by room code and never pruned — unbounded memory growth on a long-lived relay.
- LiveKit server-side rooms are never deleted (LiveKit auto-closes empty rooms, so this is acceptable).

### 2.4 Error handling, hardening — Medium
- Raw `error.message` is returned to clients on every endpoint (`index.ts:70,109,120`) — minor info disclosure, sloppy contract (clients string-match on messages like "Room already has a catcher").
- No rate limiting: 6-digit code space is 10⁶; a single IP can enumerate it via `POST /rooms/:code/join` in minutes. Unlimited `POST /rooms` is a trivial memory-exhaustion DoS (each room is a Map entry that, absent creations, never expires — see 2.3).
- `app.use(cors())` is wildcard; no `helmet`; `RoomService` clients never check HTTP status (see §4).
- WS message handler is wrapped in try/catch and `send` checks `readyState` — good. But there is no `ws` ping/pong, so half-open sockets accumulate in `sessions` and inflate `recipientCount` (coach sees "delivered" to a zombie).
- Per-message behavior is otherwise sound: role gate on `pitch_call`/`ptt_*` ("Game Mode is one-way coach-to-catcher only") works *if* the role assignment could be trusted — which it can't (2.1).

### 2.5 Relay restart mid-game — Critical
All state is in-memory (`RoomStore`, `sessions`, `diagnostics`). On restart:
1. Sockets drop; clients show "Disconnected" with no auto-reconnect (iOS) or stay dead (Expo).
2. Any rejoin attempt gets "Room not found" — the room is gone.
3. The HMAC tokens clients hold **would still verify** (secret is stable on Render) and contain everything needed (`roomCode`, `role`, `expiresAt`) to transparently *recreate* the room — but no such path exists.
4. On Render free tier this isn't an edge case: the instance sleeps after idle and the README's own advice is "open the app a minute before a demo or game test to wake it up."

---

## 3. Credential and secret handling

### 3.1 iOS side — mostly moot, because nothing is stored
- The room token is held in memory (`Room.token`, `CoreModels.swift:31`) and never persisted — and never *used* (not sent on WS join, not attached to any request). No Keychain usage anywhere; when the Bearer-token integration (§4) lands, the token **must** go in Keychain, not `UserDefaults`.
- `SettingsStore` persists only non-secret prefs (team/coach name, server URL, speech settings) in `UserDefaults` — appropriate.
- No hard-coded keys in the app. The Expo app hardcodes the backend URL (`https://dugoutcall.onrender.com`) — config, not a secret.

### 3.2 Server side — good hygiene, one bad default
- Git history scan (all 25 commits): **no real secrets committed**. Only `devkey`/`devsecret` test literals in `auth.test.ts`. `.env*` is gitignored; `.env.example` contains placeholders; `render.yaml` uses `generateValue: true` for the token secret.
- **Bad default:** `DUGOUTCALL_TOKEN_SECRET ?? 'local-development-secret-change-me'` (`index.ts:15`). Any deployment that misses the env var signs tokens with a public string. Should fail fast when `NODE_ENV=production` (currently moot since tokens aren't verified, but it becomes load-bearing the moment 2.1 is fixed).
- LiveKit secrets are env-only — correct — but missing from `render.yaml` (silent voice disablement, 2.2).

---

## 4. Integration readiness against INTEGRATION_API.md

**The contract file does not exist** — not in the working tree, not anywhere in git history (verified with a full-history search). That is itself the first blocker: the contract must be committed before conformance is even checkable. Auditing the iOS client against the described contract shape (Bearer-token auth, iOS app as client):

| Contract element | Status in `ios/` |
|---|---|
| INTEGRATION_API.md present in repo | **Missing** |
| Bearer token sent in `Authorization` header | **Not implemented** — `RoomService` sets only `Content-Type`; the token the server returns is never attached to anything |
| Secure token storage (Keychain) | **Not implemented** — no Keychain usage in the codebase |
| Token refresh / expiry handling | **Not implemented** — `Room.expiresAt` is stored and never read |
| Error-response handling | **Broken** — `RoomService.createRoom/joinRoom` ignore `HTTPURLResponse.statusCode` entirely; a 4xx/5xx `{"error": "..."}` body is fed into `JSONDecoder` for the success type, surfacing as "The data couldn't be read…" instead of the server's message |
| Retry behavior | **Not implemented** in native iOS (the Expo app has 4-attempt backoff in `requestJson`; the production client has none) |
| Auth on the realtime channel | **Not implemented** — `join_room` is sent without the token (and the server wouldn't check it; both sides need the change) |
| Defined endpoint surface | Client calls `POST /rooms`, `POST /rooms/:code/join`, WS — matches the relay, but cannot be reconciled with the scouting-platform contract until the doc exists |

**Conclusion: the integration is 0% implemented.** Every row above blocks the scouting-platform work. Restore/author INTEGRATION_API.md first, then implement an authenticated API client layer (status-code handling → typed errors → retry policy → Keychain-stored Bearer token) as one unit.

---

## 5. SwiftUI app quality

### 5.1 Backgrounding / suspension — High
No `@Environment(\.scenePhase)` anywhere; `Info.plist` declares no `UIBackgroundModes`. Sequence on a real field: catcher pockets the phone → screen locks (no `isIdleTimerDisabled` either) → app suspends → `URLSessionWebSocketTask` is torn down → every subsequent call is silently lost; AVSpeechSynthesizer can't speak from a suspended app regardless. On foreground there is no reconnect and the UI shows whatever state it last had. The coach side fails identically. This needs: foreground-reconnect on `scenePhase == .active`, idle-timer disable during an active room, and an honest "reconnecting" UI. (A background audio mode could keep the catcher alive while locked, but claiming it has App Store review implications — the minimum viable fix is keep-screen-awake + reconnect-on-foreground.)

### 5.2 Race conditions in call sending — High
- **PTT stuck-transmitting race (finding #9):** `PushToTalkButton.onPressingChanged` fires a detached `Task` per transition. Press→release faster than `start()` completes: the release `Task` runs `stop()`, whose `guard isTransmitting else { return }` exits because `start()` hasn't set it yet; `start()` then completes, sets `isTransmitting = true`, sends `ptt_start` — and nothing ever sends `ptt_stop`. Coach is stuck "Talking"; the Send button stays disabled (`.disabled(pushToTalk.isTransmitting ...)`), bricking pitch calls until app restart. The two unordered `Task`s also race `pitchService.isVoiceActive`.
- **One-slot PTT queue:** `PitchCallService.queuedCall` overwrites silently; two calls tapped during one PTT hold → first one vanishes.
- `lastCall` is only set after a successful send (good), but since callers use `try?`, "Repeat Last" can resend a call the coach believes failed, or nothing at all — indistinguishable.

### 5.3 Stale/incorrect state — High
- `ConnectionBannerView` hardcodes `"Catcher connected"` (`CoachDashboardView.swift:120`) — it renders before any catcher joins and after the catcher drops. The one thing the coach most needs to know is fabricated.
- `connectionState` optimism (§1.2) compounds this.
- `webSocket.lastError` is `@Published` and **no view displays it**; `handleMessage` routes server `error` messages to `print()` (`AppRootView.swift:106`). All failure paths are invisible.
- Coach `handleMessage` reacts to `.pttStop` by flushing the queued call — but the server only relays `ptt_stop` to *catchers*, so this branch is dead code; the real flush happens in `PushToTalkButton`. Harmless, but indicates the message flow isn't fully understood.

### 5.4 Memory / long sessions — Low
- `AudioSessionService` registers two block-based `NotificationCenter` observers and never removes them; the service is app-lifetime so it's a latent leak, not an active one.
- `receiveLoop` uses `[weak self]`; `AppRootView` closures capture services appropriately. No retain cycles found.
- `SpeechPlaybackService` queue is bounded by its 2-second interrupt heuristic. Fine.

### 5.5 Battery — Medium
The native app's footprint is small (one WS, on-demand TTS). The real battery story is the *fix* for §5.1: keeping the screen awake and the radio active for 2+ hours is necessary and should be paired with reduced-brightness guidance rather than avoided. The Expo app holds a LiveKit connection for the full session — acceptable, it's the product. One genuine bug: coach `configureForCoachPushToTalk` activates a `.playAndRecord` session on first PTT and never deactivates it after release (`AudioSessionService` has no `setActive(false)` path), keeping the audio hardware hot for the rest of the session.

---

## 6. Dugout usability (as code review)

- **Tap targets:** `ruggedTile` min-height 62 pt and `primaryDugoutButton` 58 pt clear Apple's 44 pt floor — good. But `PresetGridView` packs **4 columns**, so on an iPhone 13 mini each preset is ~80 pt wide holding two-line labels at `.headline` with `minimumScaleFactor(0.72)` — marginal for gloved/cold hands. 2–3 columns would be safer. The context chips (`0-0`, `Ahead`…) are decorative state with no transmitted effect; they cost screen height on the most space-pressed screen.
- **Accidental-call protection: none.** Presets fire on a single tap with no confirm, no undo window, no haptic distinction — and `Pickoff`/`Pitchout` (the highest-consequence calls) are one tap by design, adjacent to ordinary presets in the same grid. "Repeat Last" is also one tap. A 1.5–2 s undo window (delay-send with a cancel affordance) or a send-confirmation pattern is needed; at minimum, distinct placement/color for Pickoff/Pitchout.
- **Latency/delivery feedback: none.** No haptic, sound, or visual change on send; failures are `try?`-swallowed; the banner fabricates catcher presence (§5.3). The coach cannot distinguish delivered / in-flight / lost — on a field, that means calling the pitch twice or trusting a ghost. (Server-side ack, §1.4, is the prerequisite.)
- **One-handed reachability:** the entire coach dashboard is one `ScrollView` — banner, 8 presets, pitch grid, 9-cell location grid, context row, *then* the action row. Send and Hold-to-Talk live at the bottom of scrollable content, not pinned (`safeAreaInset`/fixed bottom bar). Between pitches the coach may have to scroll to reach Send. The Expo app gets this right with a fixed `actionBar`; the native app should match.
- **Hold-to-Talk gesture:** `onLongPressGesture(minimumDuration: 0, maximumDistance: 40)` inside a `ScrollView` — a slight finger drag past 40 pt while talking releases the press mid-sentence, and scroll-gesture arbitration can swallow the press entirely. A dedicated `DragGesture(minimumDistance: 0)` button outside the scroll area is the established PTT pattern. Plus the stuck-transmitting race (§5.2).
- **Sunlight/contrast:** dark theme (`#0D1210`-ish background) with white text is the *worst* configuration for direct sunlight — dark themes wash out badly outdoors. Secondary text uses `.foregroundStyle(.secondary)` on dark panels (low contrast), and the connection status is `.caption`-scale in the banner. The catcher screen's giant 42 pt status text is the right idea; the coach screen needs a high-contrast/outdoor consideration and bigger state indicators.
- **No exit:** the coach screen hides the back button and offers no "Leave room" (the Expo app has one). Wrong room code or a need to re-pair → force-kill the app.

---

## 7. Privacy posture (youth-sports / COPPA-adjacent)

What is collected/transmitted/stored today:

- **Identity-ish data:** `coachName`, `teamName` (free-text from Settings, sent on room create), `displayName` (hardcoded `"Catcher"` in both clients — good instinct; the server accepts arbitrary strings from anyone, and the demo-web/HTTP API would happily carry a child's real name if a client sent one).
- **Gameplay data:** every pitch call (`pitch`, `location`, `spokenText`, timestamps) transits the relay. The server's `RoomDiagnostics` **retains the last 40 events per room in memory, including `spokenText` of pitch calls and display names** (`websocket.ts:113`, `index.ts:43,87`), and serves them on the **unauthenticated** `GET /rooms/:code/diagnostics` endpoint. This is both a privacy and a competitive-integrity leak (live sign-stealing API, finding #8). Diagnostics should never store call contents or names — counters and kinds suffice.
- **Voice:** coach audio transits LiveKit (Expo build); nothing in this codebase records it. LiveKit Cloud's own retention is an external dependence worth documenting.
- **Logging:** server logs only its startup line — good. The Expo app surfaces diagnostics on-screen only. iOS `print()`s server errors (harmless, remove anyway).
- **No analytics, no third-party SDKs beyond LiveKit/Expo, no ads, no accounts.** Data minimization is genuinely good.
- **App Store / COPPA-adjacent gaps:** no privacy policy URL (required for App Store submission); the privacy nutrition label will need to declare names + audio; the catcher device is operated by a minor, so the eavesdropping vulnerability (2.1) is not just security — an unauthenticated stranger can listen to a channel pointed at a child's AirPods, which is exactly the headline an App Store reviewer or league would write. Fixing relay auth is a privacy requirement, not only a security one.
- One more reviewer-bait item: the app's own README markets one-way covert communication "where permitted by league/state association" — keep the in-app compliance copy (already present on every screen, good) and expect review questions.

---

## 8. Test coverage

### Relay (`server/tests/` — vitest, runs in CI)
Covered: room creation/expiry/role limits (`rooms.test.ts`), HMAC token round-trip + tamper rejection (`auth.test.ts` — testing a function production never calls), LiveKit token env gating + role scoping, WS relay happy paths incl. catcher re-attach and diagnostics counters (`websocket.test.ts`), ICE config parsing (`config.test.ts`).

**Riskiest untested paths:**
1. The HTTP layer — `index.ts` has zero tests (no supertest): join of nonexistent/expired room, error shapes, diagnostics endpoint.
2. Negative auth paths *that should exist*: join with missing/invalid/expired token (untestable until 2.1 is fixed — write the tests with the fix).
3. Room expiry against **live sockets** (relay continues past expiry — 2.3).
4. Duplicate-coach socket behavior (the hijack vector, 2.1).
5. Malformed/oversized WS payloads; non-JSON frames; `join_room` with bogus role.
6. Restart/recovery semantics (none exist; tests should pin the recovery design when built).

### iOS (`ios/Tests/` — 3 files, model-only)
Covered: pitch phrase composition, repeat-ID freshness, preset vocabulary, message JSON shape. All pure-model; per README they may never have run (repo authored on Windows; `swift test` needs macOS).

**Riskiest untested paths:** everything that fails in the field — `WebSocketService` (state transitions, send-while-nil-task silently succeeding), `RoomService` decoding error bodies, `PitchCallService` queue-overwrite and error propagation, the PTT race (§5.2), `SettingsStore` round-trip. `WebSocketService` and `RoomService` take an injected `URLSession`, so they're mockable today (via `URLProtocol` stubs) — the seams exist, the tests don't.

### Expo app (`mobile/`)
Zero tests; only `tsc --noEmit`. It is the build actually on TestFlight. At minimum, extract and unit-test the pure helpers (`phrase`, `websocketUrl`, `requestJson` backoff) — `App.tsx` is a 2,000-line single component, which is itself the testability problem.

### CI
`.github/workflows/ci.yml` runs server tests + build + PWA config build. No Swift job (needs a macOS runner), no Expo typecheck job. Adding `tsc --noEmit` for `mobile/` is free.

---

*Companion document: [CODEX_TASKS.md](./CODEX_TASKS.md) — top 10 improvements as standalone implementation prompts, reliability and relay security first.*
