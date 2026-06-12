# Diamond Scout iOS Handoff

This document covers how to see and test the Diamond Scout integration inside the native SwiftUI DugoutCall app.

## Current Status

- Branch: `main`
- App path: `ios/Package.swift`
- Contract: `docs/INTEGRATION_API.md`
- Default behavior: mock mode is on when Diamond Scout API base URL or Bearer token is empty.
- The Diamond Scout server contract says `/api/v1` is not implemented yet on the Diamond Scout server side, so live mode is expected to be blocked until that service exists.

## What Should Be Visible

From app launch, the role screen now has a third button:

- Coach Mode
- Catcher Mode
- Diamond Scout

The Diamond Scout flow contains:

- Diamond Scout home
- Opponents list
- Games list
- Game detail
- Current hitter
- Hitter card
- Sample pitch-event post action

When mock mode is active, Diamond Scout screens show a visible `MOCK DATA` badge.

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
8. On launch, tap `Diamond Scout`.
9. Confirm the `MOCK DATA` badge is visible.
10. Tap `Opponents`.
11. Tap `Edina Hornets 14AAA`.
12. Tap the visible game.
13. Tap a lineup hitter to open the hitter card.
14. Return to Diamond Scout home and tap `Current Hitter`.
15. On the game detail screen, tap `Post Sample Pitch Event`.

## Expected Mock Data

Mock mode includes:

- Program: Diamond Scout, 2026
- Opponents:
  - Edina Hornets 14AAA
  - Chaska Hawks 14AAA
- Game:
  - Edina Hornets 14AAA, Away, Edina Varsity Field
- Hitter card:
  - `#4 Isaiah Kelly`
  - Tier 1 - Handle with care
  - Good confidence
  - Pitch plan: Pound away until he adjusts.
  - Coach note: Hold runners 1-0.

## Verification Notes

Verified on the Windows development host:

- DugoutCall `main` contains the Diamond Scout SwiftUI route.
- `docs/INTEGRATION_API.md` is present.
- Existing Node server tests pass.
- Whitespace diff checks pass.

Not verified on the Windows host:

- Xcode simulator build.
- `swift test`.

Reason: Swift/Xcode tooling is not installed on this machine. Run Xcode build and Swift tests on a Mac before treating native compilation as proven.

## BLOCKED ON SERVER

Live Diamond Scout mode depends on the server implementing the endpoints in `docs/INTEGRATION_API.md`, especially:

- `GET /api/v1/session`
- `GET /api/v1/opponents`
- `GET /api/v1/games`
- `GET /api/v1/games/{game_id}`
- `GET /api/v1/games/{game_id}/current-hitter`
- `GET /api/v1/opponents/{opponent_id}/hitters/{hitter_id}/card`
- `GET /api/v1/opponents/{opponent_id}/hitters/by-jersey/{jersey}/card`
- `POST /api/v1/games/{game_id}/events`

Until those server endpoints exist with Bearer-token tenant auth, use mock mode for UI testing.
