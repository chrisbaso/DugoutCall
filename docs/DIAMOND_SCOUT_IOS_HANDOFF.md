# Diamond Scout iOS Handoff

This document covers how to see and test the Diamond Scout integration inside the native SwiftUI DugoutCall app.

## Current Status

- Branch: `main`
- App path: `ios/Package.swift`
- Contract: `docs/INTEGRATION_API.md`
- Default behavior: mock mode is on when Diamond Scout API base URL or Bearer token is empty.
- The Diamond Scout server contract says `/api/v1` is not implemented yet on the Diamond Scout server side, so live mode is expected to be blocked until that service exists.

## What Should Be Visible

Scouting data is ambient on the pitch-calling screen. There is no separate
Diamond Scout navigation button anymore.

- The role screen has two buttons: Coach Mode and Catcher Mode.
- Entering the Coach Dashboard automatically batch-fetches the opposing
  lineup's scouting summaries and caches them for the game session.
- A compact hitter card sits above the pitch grid showing the current hitter:
  jersey/name/bats, a one-line verdict, up to three attack-plan chips, and a
  native heat-fan chart rendered from JSON zone values.
- The `Next` control on the right edge of the card advances to the next batter
  instantly from cache; a throttled background batch refresh keeps the current
  and on-deck hitters fresh.
- Tapping the card opens the full scouting report sheet; `Done` returns to the
  call screen with count and selections intact.
- Room code, connection dot, AirPods state, and live-voice indicator live in
  the navigation toolbar; the settings gear stays in the top-right.
- Hitters with no scouting data show a muted "No scouting data" card; pitch
  calling is unaffected.
- When mock mode is active, the card and the report sheet show a visible
  `MOCK DATA` badge.

## Configuration

Open the gear icon, then use the `Diamond Scout Debug` section:

- `Use mock Diamond Scout data`
- `API base URL`
- `Bearer token`

Live mode calls the configured base URL under `/api/v1` and sends:

```http
Authorization: Bearer <token>
```

If mock mode is off but either the API base URL or Bearer token is empty, the app still uses mock data.

## TO SEE THE NEW UI

1. Pull branch: `main`.
2. Open `DugoutCall/ios/Package.swift` in Xcode.
3. Select scheme: `DugoutCall`.
4. Select an iPhone simulator.
5. In Xcode, choose `Product > Clean Build Folder`.
6. Delete the old DugoutCall app from the simulator.
7. Build and run.
8. Tap `Coach Mode`, then `Create Room`, then `Enter Coach Dashboard`.
9. The hitter card appears above the pitch grid with the `MOCK DATA` badge
   showing `#4 Isaiah Kelly`.
10. Tap `Next` on the card edge to cycle batters; slot 4 (`#23 Quinn Walsh`)
    shows the muted no-data state.
11. Tap the card body to open the full scouting report sheet; tap `Done`.
12. Call pitches normally; the card never blocks the grid or send button.

## Expected Mock Data

Mock mode includes:

- Program: Diamond Scout, 2026
- Game: Edina Hornets 14AAA, Away, Edina Varsity Field (in progress)
- Lineup summaries:
  - `#4 Isaiah Kelly` (R) - "Dead-red early in counts; chases low-away with two strikes." - `Start soft`, `Climb w/ 2K`
  - `#8 Mason Strey` (L) - "Late trigger; vulnerable to velocity on the inner half." - `Challenge in`, `FB up`, `No waste pitches`
  - `#12 Nolan Price` (R) - "Bunt threat; slap contact to the left side." - low sample
  - `#23 Quinn Walsh` - no scouting data (muted card state)
- Full report sheet:
  - `#4 Isaiah Kelly`, Tier 1 - Handle with care, Good confidence
  - Pitch plan: Pound away until he adjusts.
  - Coach note: Hold runners 1-0.

## Offline Behavior

The lineup batch is persisted on device with a game-session TTL. After the
lineup has been fetched once, airplane mode keeps every hitter card rendering
from cache, and background refresh failures are silent. With no cache and no
network, the card shows the no-data state and pitch calling is unchanged.

## Verification Notes

Verified in a Linux container (no Swift/Xcode toolchain):

- Node relay server tests pass.
- Swift sources updated; compile and `swift test` are verified via the iOS
  GitHub Actions workflow (macOS runner), not locally.

Run an Xcode simulator build on a Mac before treating native UI behavior as
proven.

## BLOCKED ON SERVER

Live Diamond Scout mode depends on the server implementing the endpoints in `docs/INTEGRATION_API.md`, especially:

- `GET /api/v1/session`
- `GET /api/v1/opponents`
- `GET /api/v1/games`
- `GET /api/v1/games/{game_id}`
- `GET /api/v1/games/{game_id}/current-hitter`
- `GET /api/v1/games/{game_id}/lineup-summaries` (new; powers the ambient hitter card)
- `GET /api/v1/opponents/{opponent_id}/hitters/{hitter_id}/card`
- `GET /api/v1/opponents/{opponent_id}/hitters/by-jersey/{jersey}/card`
- `POST /api/v1/games/{game_id}/events`

Until those server endpoints exist with Bearer-token tenant auth, use mock mode for UI testing.
