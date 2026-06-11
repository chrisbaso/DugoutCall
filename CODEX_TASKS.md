# CODEX_TASKS — Top 10 Improvements

Standalone prompts for a coding agent. Each task is self-contained: goal, files, approach, acceptance criteria, do-not-touch list. Ordered by priority: connection reliability and relay security first.

**Conventions for all tasks**
- iOS/SwiftUI tasks are implemented by a coding agent and verified by a human in Xcode: every iOS acceptance criterion must be checkable by building and running the app (simulator or device), not by unit tests alone.
- Server tasks must keep `npm test` and `npm run build` (in `server/`) green and add tests for the new behavior.
- Never weaken the Game Mode one-way rule: no catcher-originated content reaches the coach UI. Server-side delivery receipts are allowed; catcher acknowledgements are not.
- Do not commit secrets. Do not touch `demo-web/` unless a task names it.

---

## Task 1 — iOS: WebSocket reconnect with backoff, honest connection state, and heartbeats

**Goal:** The native app survives network drops without the coach or catcher restarting anything. Connection state shown in the UI reflects reality.

**Files affected:**
- `ios/Sources/DugoutCall/Services/WebSocketService.swift` (main rewrite)
- `ios/Sources/DugoutCall/App/AppRootView.swift` (wire rejoin context)
- `ios/Sources/DugoutCall/Features/Coach/CoachDashboardView.swift`, `ios/Sources/DugoutCall/Features/Catcher/CatcherReceiverView.swift` (display new states)
- `ios/Sources/DugoutCall/Models/CoreModels.swift` (extend `ConnectionState` with `.reconnecting` if needed)

**Approach:**
1. Adopt `URLSessionWebSocketDelegate`: set `connectionState = .connected` only in `urlSession(_:webSocketTask:didOpenWithProtocol:)`; handle `didCloseWith` and receive-loop failures identically.
2. Store the last join context (`serverURL`, `code`, `role`, `displayName`) in the service. On any close/failure while a room is active: transition to `.reconnecting`, retry with exponential backoff + jitter (1s, 2s, 4s… cap 30s, no attempt limit — games last 2+ hours), and on reopen automatically resend `join_room`.
3. Send a `heartbeat` message every 20s while connected; if no server `heartbeat` echo arrives within 10s, treat the socket as dead and enter the reconnect path (this catches silent NAT timeouts).
4. Make `send` throw a real error when there is no open task (replace the silent `task?.send` no-op with a thrown `WebSocketError.notConnected`).
5. Keep the service `@MainActor`; do timers via `Task.sleep` loops tied to the service lifecycle so they cancel on `disconnect()`.

**Acceptance criteria (verify in Xcode):**
- Run coach + catcher (two simulators or devices) against a local server. Kill the server process: within seconds both apps show "Reconnecting" (not "Connected"). Restart the server: both apps return to "Connected" and a pitch call goes through **without any user action** (requires Task 4's restart recovery for the room to exist; against a non-restarted server, toggling Mac Wi-Fi off/on suffices to verify).
- With the app freshly launched and a wrong server URL, the UI never shows "Connected".
- Enable airplane mode on the coach device mid-session, disable it: app reconnects and the next call is delivered.
- No timer or receive loop keeps running after "Emergency Disconnect" (verify via Xcode debug gauges: CPU returns to idle).

**Do not touch:** `server/` (heartbeat already exists server-side), `mobile/`, `demo-web/`, message wire formats in `DugoutMessage.swift`, the Game Mode one-way rules, `SpeechPlaybackService.swift`.

---

## Task 2 — Relay: enforce room-token auth on the WebSocket and diagnostics, fail fast on default secret

**Goal:** Nobody joins a room's socket or reads its diagnostics without the signed token issued at create/join time. Production refuses to boot with the development secret.

**Files affected:**
- `server/src/websocket.ts` (verify token on `join_room`)
- `server/src/index.ts` (diagnostics auth; fail-fast secret check; pass secret into `attachWebSocketServer`)
- `server/src/types.ts` (make `token` required on `join_room`)
- `server/tests/websocket.test.ts`, new `server/tests/http.test.ts` (negative-path tests)
- `ios/Sources/DugoutCall/Services/WebSocketService.swift`, `ios/Sources/DugoutCall/Models/DugoutMessage.swift`, `ios/Sources/DugoutCall/App/AppRootView.swift` + pairing views (send the token on join)
- `mobile/App.tsx` (send the token on socket join; send it as a query/header on diagnostics fetch)

**Approach:**
1. Server: in the `join_room` handler call `verifyRoomToken(message.token, tokenSecret)`; reject (send `error`, do not set `session.code/role`) when the token is missing, invalid, expired, or when `claims.roomCode !== message.code` or `claims.role !== message.role`. The role used for the session comes from the **verified claims**, not the client's word.
2. Diagnostics: require the token via `Authorization: Bearer <token>` (or `?token=`) on `GET /rooms/:code/diagnostics`; verify roomCode match. 401 otherwise.
3. Startup: if `NODE_ENV === 'production'` and `DUGOUTCALL_TOKEN_SECRET` is unset, `throw` before listening. Keep the dev fallback for non-production.
4. Clients: `join_room` gains a `token` field. iOS: thread `Room.token` (already stored) through `WebSocketService.join`; encode it in `DugoutMessage.joinRoom`. Expo: include `room.token` in the join payload and diagnostics fetch.
5. Tests: join without token rejected; with tampered token rejected; with wrong-role token rejected; happy path with valid token; diagnostics 401 without token.

**Acceptance criteria:**
- `npm test --prefix server` passes including the new negative-path tests.
- `wscat`-style manual check (documented in the PR description): `{"type":"join_room","code":"<code>","role":"coach"}` without a token receives an `error` message and subsequent `pitch_call` is rejected with "Join a room before sending messages".
- `NODE_ENV=production node dist/index.js` without the secret exits non-zero with a clear message.
- iOS verification in Xcode: coach create → dashboard works; catcher join → receives calls (i.e., the token is threaded correctly and nothing regressed).

**Do not touch:** `auth.ts` token format (it's sound; don't migrate to JWT in this task), LiveKit grant logic, `rooms.ts` join semantics, `demo-web/` (it will break against an auth-enforcing server — acceptable for a dev harness; note it in the PR, don't fix it here).

---

## Task 3 — End-to-end delivery feedback: server ack + iOS sent/delivered/failed states

**Goal:** The coach knows, within ~2 seconds and at a glance, whether each call reached the catcher's device socket. Failed sends are visible and re-sendable, never silently dropped.

**Files affected:**
- `server/src/websocket.ts`, `server/src/types.ts` (new `call_ack` server message carrying `id` + `recipientCount`)
- `ios/Sources/DugoutCall/Services/PitchCallService.swift` (track in-flight calls, timeout, surface status)
- `ios/Sources/DugoutCall/Models/DugoutMessage.swift` (decode `call_ack`)
- `ios/Sources/DugoutCall/Features/Coach/CoachDashboardView.swift` (status strip: "Delivered ✓ Fastball away 14:02:11" / "NOT DELIVERED — tap to resend"; haptic on delivered and on failure)
- `ios/Sources/DugoutCall/App/AppRootView.swift` (route `call_ack` to the service)
- `server/tests/websocket.test.ts`

**Approach:**
1. Server: after relaying a `pitch_call`, send the **coach** socket `{type:"call_ack", id, recipientCount, timestamp}`. This is server-originated, not catcher-originated — it does not violate the one-way rule (no catcher action involved).
2. iOS: `PitchCallService.send` records the call as `.sending`; on matching `call_ack` with `recipientCount >= 1` mark `.delivered` (success haptic via `UINotificationFeedbackGenerator`); with `recipientCount == 0` or after a 3s timeout or a thrown send error, mark `.failed` (error haptic). Replace every `try? await pitchService.send` call site with paths that surface failure state.
3. Failed calls render as a prominent high-contrast banner with one-tap resend. Keep at most the latest call's status — no history list (respect `localPitchHistoryEnabled` default-off).

**Acceptance criteria (verify in Xcode):**
- Coach + catcher connected: tap a preset → status shows Delivered with a checkmark and a haptic fires (device) within ~1s.
- Kill the catcher app, coach sends → status shows "not delivered" (recipientCount 0) distinctly from network failure.
- Airplane-mode the coach, send → failed state with resend affordance; disable airplane mode (with Task 1 merged, after auto-reconnect) → tap resend → delivered.
- Catcher UI is unchanged: no read receipts, no new catcher-side UI.
- `npm test --prefix server` passes with a new test asserting the ack's `id` and `recipientCount`.

**Do not touch:** the catcher's message handling beyond decoding compatibility, `ptt_*` flow, `SpeechPlaybackService`, diagnostics recording.

---

## Task 4 — Relay: restart/sleep recovery, periodic cleanup, and `room_closed` lifecycle

**Goal:** A relay restart (Render free-tier sleep, deploy, crash) mid-game is invisible to users: clients holding valid signed tokens transparently re-establish the room. Rooms get cleaned up and announce their closure.

**Files affected:**
- `server/src/websocket.ts` (token-based room resurrection on join; expiry enforcement on live sessions)
- `server/src/rooms.ts` (add `restoreRoom(claims)`; periodic sweep timer; sweep callback)
- `server/src/index.ts` (wire sweep → broadcast `room_closed`; resurrection on HTTP join too)
- `server/src/diagnostics.ts` (drop a room's diagnostics when it is deleted)
- `server/tests/rooms.test.ts`, `server/tests/websocket.test.ts`

**Approach (depends on Task 2 being merged — joins carry verified tokens):**
1. On `join_room` (and HTTP `POST /rooms/:code/join` with a Bearer token): if the room doesn't exist but the presented token verifies and is unexpired, **recreate** the room with `code`/`expiresAt` from the claims and proceed. The HMAC signature is the proof the relay itself issued this room.
2. Run `cleanupExpired()` on a `setInterval` (60s, `unref()`d). When a room is deleted by sweep, send `{type:"room_closed", reason:"expired"}` to its live sessions, close those sockets, and delete the room's diagnostics entries.
3. Reject relaying on sessions whose room has expired (check on message handling, not just join).
4. Add `ws` server-side ping every 30s; terminate sockets that miss two pongs, so zombie sessions stop inflating `recipientCount`.

**Acceptance criteria:**
- New test: create room → capture token → new `RoomStore` (simulated restart) → `join_room` with the old token succeeds and relays a pitch call.
- New test: expired token does **not** resurrect a room.
- New test: after TTL elapses (fake clock), live catcher socket receives `room_closed` and further coach `pitch_call` is rejected.
- Manual: start server, create/join from two clients, restart the server process, clients rejoin (with Task 1 merged this is automatic) and a call flows — documented in the PR with the exact steps used.
- `npm test --prefix server` green.

**Do not touch:** token format in `auth.ts`, LiveKit token issuance (LiveKit reconnection covers its own restart story), `ios/` and `mobile/` (no client change needed — that's the point), `ROOM_TTL_MS` semantics.

---

## Task 5 — Relay hardening: rate limiting, brute-force lockout, scrub diagnostics payloads

**Goal:** The 6-digit code can't be enumerated, the relay can't be memory-DoS'd via room creation, and diagnostics never store the content of pitch calls or people's names.

**Files affected:**
- `server/src/index.ts` (rate limits, CORS tightening, body limits)
- `server/src/websocket.ts` (stop passing `spokenText`/`displayName` into diagnostics; cap joins per socket)
- `server/src/diagnostics.ts` (type-level removal of free-text `detail` for call events; cap total tracked rooms)
- `server/package.json` (add `express-rate-limit` or implement a small in-memory limiter — prefer the tiny dependency)
- `server/tests/` (limiter + scrub tests)

**Approach:**
1. Per-IP limits: `POST /rooms` 10/hour; `POST /rooms/:code/join` 10/minute with a global per-code failure counter — after 20 failed joins for a code, lock that code for 10 minutes (defeats distributed guessing of a specific room).
2. `express.json({ limit: '10kb' })`; cap WS message size via `WebSocketServer({ maxPayload: 16 * 1024 })`.
3. Diagnostics scrub: `record()` calls for `pitch_call` keep only `kind`, `role`, `recipientCount`, `timestamp` — delete the `detail: message.spokenText` and `detail: displayName` arguments at all call sites (`websocket.ts`, `index.ts`). Update the Expo `roomDiagnosticSummary` only if it referenced details (it uses counters — no change needed).
4. Replace `app.use(cors())` with an allowlist from `DUGOUTCALL_CORS_ORIGINS` env (default: allow all in non-production only). Native apps don't send Origin, so this can't break them.
5. Keep error responses generic in production (`'Unable to join room'`) while logging specifics server-side.

**Acceptance criteria:**
- Tests: 11th room creation from one IP within the window → 429; 21st failed join for one code → 423/429 even from a "new IP"; diagnostics snapshot after a relayed pitch call contains **no** `spokenText` and no display names.
- Manual `curl` loop in PR description demonstrating the 429.
- `npm test --prefix server` and `npm run build --prefix server` green; existing relay tests unmodified except where they asserted the now-removed `detail` field.

**Do not touch:** room code length/format (6 digits is a product decision; lockout makes it safe enough), `auth.ts`, client code in `ios/`/`mobile/` (the scrub is server-side only), heartbeat behavior.

---

## Task 6 — iOS: fix the push-to-talk stuck-transmitting race and gesture fragility

**Goal:** No sequence of presses, releases, or finger slides can leave `isTransmitting` stuck true (which also bricks the Send button), and PTT works reliably inside the scrolling dashboard.

**Files affected:**
- `ios/Sources/DugoutCall/Services/PushToTalkService.swift`
- `ios/Sources/DugoutCall/Features/Coach/PushToTalkButton.swift`
- `ios/Sources/DugoutCall/Services/PitchCallService.swift` (`isVoiceActive` coupling)

**Approach:**
1. Serialize start/stop: give `PushToTalkService` a monotonically increasing press generation counter (or a single serialized `Task` queue). `start()` records the generation; when it completes, if a release for that generation already happened, immediately run the stop path. `stop()` no longer early-returns on `!isTransmitting` — it becomes "ensure not transmitting": if a start is in flight, mark it cancelled so the start's completion sends `ptt_stop` and resets state.
2. Drive `pitchService.isVoiceActive` from inside the service (didSet on transmitting/pending state), not from the view's racing `Task`s.
3. Replace `onLongPressGesture(minimumDuration:0, maximumDistance:40)` with a `DragGesture(minimumDistance: 0)` `onChanged`/`onEnded` pair (the standard hold-button pattern), and give the button `.frame(minHeight: 72)`. If gesture/scroll arbitration still steals the press in testing, hoist the Talk button out of the `ScrollView` (coordinates with Task 8's pinned action bar).
4. Add a safety: if transmitting and the WS reports disconnected (Task 1 state), auto-run the stop path locally so the UI never wedges.

**Acceptance criteria (verify in Xcode, device preferred for gestures):**
- Rapidly tap the Talk button 20 times: button always returns to "Hold to Talk", Send button re-enables, and the server diagnostics counters show equal `ptt_start` and `ptt_stop` counts.
- Press, slide finger 100 pt away, release: transmission stops (no stuck "Talking").
- Hold Talk, tap a preset, release Talk: the queued call sends exactly once after release.
- Normal hold-and-speak flow unchanged (catcher sees "Receiving voice" then "Waiting for call").

**Do not touch:** `AudioSessionService` configuration calls, the wire format of `ptt_start`/`ptt_stop`, `server/`, the one-slot queued-call semantics (a deliberate product choice: latest call wins).

---

## Task 7 — iOS: real HTTP error handling, retries, and ATS fix in `RoomService`

**Goal:** Create/join failures show the server's actual error ("Room expired", "Room already has a catcher") instead of a JSON-decoding error; transient failures (asleep Render instance, flaky cellular) are retried; the documented LAN setup actually works on a device.

**Files affected:**
- `ios/Sources/DugoutCall/Services/RoomService.swift`
- `ios/Sources/DugoutCall/Features/Pairing/CreateRoomView.swift`, `JoinRoomView.swift` (display the typed errors)
- `ios/Sources/DugoutCall/App/Info.plist` (ATS local-networking exception)
- `ios/Tests/DugoutCallTests/` (new `RoomServiceTests.swift` using a `URLProtocol` stub)

**Approach:**
1. In both `RoomService` methods: cast to `HTTPURLResponse`; on non-2xx decode `{"error": String}` and throw a `RoomServiceError.server(message:status:)`; on decode failure throw `.invalidResponse`. Add `.network(underlying:)` for transport errors.
2. Retry policy mirroring the Expo app: up to 4 attempts with 0/1.2/2.5/5s delays for transport errors and 5xx; never retry 4xx. Surface "Waking server…" progress through a callback or `@Published` so the pairing views can show it (Render free tier cold-start is a known, normal path).
3. Request timeout: 10s per attempt (`URLRequest.timeoutInterval`).
4. Add `NSAppTransportSecurity > NSAllowsLocalNetworking = true` to `Info.plist` (scoped key — do **not** use `NSAllowsArbitraryLoads`), so `http://192.168.x.x:8787` dev setups work while production stays HTTPS-only.
5. Unit tests with a stub `URLProtocol`: 400-with-error-body surfaces the message; 500-then-200 succeeds via retry; 404 does not retry.

**Acceptance criteria (verify in Xcode):**
- Join a nonexistent code against a live server: the screen shows "Room not found" (server's message), not "The data couldn't be read…".
- Point the app at a stopped local server: UI shows a clear network error after the retry sequence (~9s), not a hang or decode error.
- On a physical device with the Mac's LAN IP over plain HTTP: create room succeeds (ATS no longer blocks).
- `swift test` passes on macOS including the new `RoomServiceTests`.

**Do not touch:** `server/` response shapes, `WebSocketService` (Task 1 owns it), the Expo app's `requestJson`, default server URL in `SettingsStore`.

---

## Task 8 — iOS: truthful coach dashboard with pinned action bar, leave-room, and accidental-call protection

**Goal:** The coach screen tells the truth (catcher presence, connection), keeps Send/Talk reachable one-handed without scrolling, can exit a room, and protects against fat-finger sends of high-consequence calls.

**Files affected:**
- `ios/Sources/DugoutCall/Features/Coach/CoachDashboardView.swift` (banner truth, layout, leave, undo window)
- `ios/Sources/DugoutCall/Features/Coach/PresetGridView.swift` (3 columns, bigger tiles, visual separation for Pitchout/Pickoff)
- `ios/Sources/DugoutCall/App/AppRootView.swift` (leave-room plumbing for the coach path — mirror the existing catcher disconnect closure)
- `server/src/websocket.ts` + `server/src/types.ts` (tiny addition: `peer_status` message to coach when a catcher socket joins/leaves — server-originated presence, not a catcher acknowledgement)
- `ios/Sources/DugoutCall/Models/DugoutMessage.swift` (decode `peer_status`)

**Approach:**
1. **Truth:** delete the hardcoded `"Catcher connected"`. Server: on catcher `socket_joined`/`close`, send the coach `{type:"peer_status", role:"catcher", connected:Bool}`. Banner states: "Waiting for catcher" / "Catcher connected" / "Catcher dropped" / "Reconnecting…" (from Task 1's state). Show `webSocket.lastError` when present instead of `print`ing.
2. **Layout:** move Send / Repeat / Clear / Talk into a fixed bottom bar via `.safeAreaInset(edge: .bottom)`; min control height 64 pt; the grids alone scroll. Drop or collapse the context-chip row (it transmits nothing) behind a disclosure to reclaim height.
3. **Leave:** toolbar "Leave" button with a confirmation dialog → clears `role`/`room`, disconnects (same flow the catcher already has).
4. **Accidental-call protection:** sends triggered by Presets and Repeat Last enter a 1.5 s pending window — the bottom bar shows "Sending: Curve Down — CANCEL"; tapping cancel aborts before the message goes out; the timer then hands off to Task 3's delivered/failed flow. Pitch-grid+Send flow (already two taps) sends immediately. Style Pitchout/Pickoff tiles in the accent (red) color and place them in their own labeled row.
5. Keep all text high-contrast (white on panel, no `.secondary` for state-critical lines) and state lines at `.title3` or larger.

**Acceptance criteria (verify in Xcode):**
- Create a room, don't join a catcher: banner reads "Waiting for catcher". Join the catcher: flips to "Catcher connected" without coach interaction. Kill the catcher app: flips to "Catcher dropped" within the heartbeat window.
- On an iPhone SE/13-mini-class simulator, Send and Hold-to-Talk are visible and tappable without scrolling, with all grids fully expanded.
- Tap a preset → cancel within the window → catcher hears nothing and no `pitch_call` appears in server diagnostics counters; let it elapse → catcher hears it.
- Coach can leave the room and create a new one without relaunching.
- `npm test --prefix server` green with a test for `peer_status` emission.

**Do not touch:** catcher screen UI (beyond decode compatibility), the one-way rule (peer_status is socket-presence from the server, never a catcher action), `PitchCallService` send internals beyond the pending-window hook, `DugoutTheme` palette values.

---

## Task 9 — iOS: lifecycle handling — reconnect on foreground, keep screen awake in-session

**Goal:** Locking the phone or switching apps mid-game doesn't silently kill the session; while a room is active the screen stays awake so iOS never suspends the catcher's receiver.

**Files affected:**
- `ios/Sources/DugoutCall/App/AppRootView.swift` (scenePhase observation)
- `ios/Sources/DugoutCall/Services/WebSocketService.swift` (expose `reconnectNow()`; built in Task 1)
- `ios/Sources/DugoutCall/Features/Catcher/CatcherReceiverView.swift`, `Coach/CoachDashboardView.swift` (idle-timer scope, "was disconnected" notice)

**Approach:**
1. Observe `@Environment(\.scenePhase)`. On `.active` with an active room: force an immediate reconnect/heartbeat check (don't wait for backoff), and refresh `AudioSessionService` state. On `.background`: mark the time; on return, if the gap exceeded the heartbeat interval, treat the socket as suspect and reconnect proactively.
2. Set `UIApplication.shared.isIdleTimerDisabled = true` when a room becomes active (coach or catcher) and restore `false` on leave/disconnect — scoped, never app-global. This is the primary mitigation for catcher suspension; pair it with a one-line tip on the catcher screen ("Keep this screen on during the game — lower brightness to save battery").
3. On the catcher, after a foreground-reconnect, show a transient "Reconnected — calls during the gap were missed" notice so a silent gap is never mistaken for "no calls were made". (Coach side already gets failed-send feedback from Task 3.)

**Acceptance criteria (verify in Xcode, physical device for lock behavior):**
- With a room active, the device does not auto-lock after the system auto-lock interval.
- Background the catcher app (home swipe), send 2 calls from the coach, foreground the catcher: app shows the reconnected notice and resumes receiving the *next* call (with Tasks 1+3, the coach saw the 2 backgrounded calls as not-delivered/failed).
- Leave the room: auto-lock behaves normally again (idle timer restored).
- Take a phone call on the catcher device mid-session, end it: TTS playback works on the next pitch call (audio session recovers).

**Do not touch:** `Info.plist` background modes (do not add `UIBackgroundModes audio` in this task — it has App Store review implications and needs a product decision), `server/`, `mobile/`, PTT logic.

---

## Task 10 — iOS: native LiveKit voice transport (close the "Hold to Talk does nothing" gap)

**Goal:** The native SwiftUI app actually transmits coach voice to the catcher via LiveKit, matching the Expo build, with role-scoped tokens from the existing relay endpoints.

**Files affected:**
- `ios/Package.swift` (add `https://github.com/livekit/client-sdk-swift` dependency)
- `ios/Sources/DugoutCall/Services/RoomService.swift` (decode the `livekit: {serverUrl, token, roomName}?` field already returned by the server)
- New: `ios/Sources/DugoutCall/Services/LiveAudioTransport.swift` (protocol per `docs/superpowers/plans/2026-05-05-native-ios-rescope.md` Task 3: `startTransmitting`/`stopTransmitting`/`startReceiving`/`stopReceiving`) and `LiveKitAudioTransport.swift` (implementation)
- `ios/Sources/DugoutCall/Services/PushToTalkService.swift` (drive the transport around the existing `ptt_start`/`ptt_stop` signals)
- `ios/Sources/DugoutCall/App/AppRootView.swift`, `CreateRoomView.swift`, `JoinRoomView.swift` (thread credentials; connect on room entry)
- `ios/Sources/DugoutCall/Features/Catcher/CatcherReceiverView.swift` (voice status from transport state)

**Approach:**
1. Decode `livekit` as optional in `CreateRoomResponse`/`JoinRoomResponse`; when nil, keep today's behavior and show "Live voice unavailable" instead of pretending.
2. Connect the LiveKit room on entering coach/catcher screens (catcher: `autoSubscribe` on, playback through the current audio route so AirPods work; coach: connect with mic **disabled**). Mirror the Expo app's proven settings (`App.tsx` `connectLiveKitVoice` / `configureLiveKitAudio`) — same audio session category (`playAndRecord`, `voiceChat`, `defaultToSpeaker`+`allowBluetooth`) on the coach, playback route on the catcher.
3. PTT press = `localParticipant.setMicrophoneEnabled(true)`; release = disable. Keep sending `ptt_start`/`ptt_stop` over the relay WS for the catcher's status UI. Integrate with Task 6's race-safe service.
4. Surface LiveKit connection state (connected / reconnecting / disconnected) into the coach banner and catcher status; rely on LiveKit's built-in reconnection.
5. Server-side trust boundary is already correct (coach-only publish grant) — no server changes.

**Acceptance criteria (verify in Xcode, two physical devices with a LiveKit-configured server):**
- Coach holds Talk and speaks → catcher hears live voice through its selected audio route (AirPods if connected); release → audio stops within ~1s.
- Catcher cannot transmit: no code path enables the catcher mic (inspect: transport's `startTransmitting` is never reachable in catcher role; LiveKit token grant blocks it server-side regardless).
- With LiveKit env vars absent on the server, the app shows "Live voice unavailable" and pitch calls still work — no crash, no fake "Receiving voice".
- Toggle Wi-Fi off/on on the coach during a session: voice recovers via LiveKit reconnection without leaving the room.
- `swift build` succeeds; the app still builds with the package resolved (human verifies in Xcode 15+).

**Do not touch:** `server/src/auth.ts` grants (already correct), the relay's `ptt_*` message contract, the Expo app, `SpeechPlaybackService` (pitch-call TTS stays independent of voice transport), Game Mode one-way enforcement.

---

## Suggested sequencing

1 → 2 → 3 → 4 (reliability/security core, each builds on the last) → 5 (hardening) → 6, 7 (independent fixes) → 8, 9 (UX/lifecycle, 8 depends on 1+3) → 10 (feature, depends on 6).
