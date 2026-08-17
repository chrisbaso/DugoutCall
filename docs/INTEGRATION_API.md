# Diamond Scout integration API

Diamond is the canonical API and data owner. The machine-readable contract is `docs/contracts/diamond-dugoutcall-2026-08-17.json`; Expo runtime validators/types and Swift reference models must stay compatible with it.

## Boundary

The coach app talks directly to Diamond over HTTPS with a team-scoped device credential. The DugoutCall backend never receives that credential and does not proxy Diamond. The catcher has no Diamond client. Scouting data is not sent through WebSockets or LiveKit.

`POST /api/v1/device-pairings/exchange` exchanges an eight-character, approximately ten-minute, one-use pairing code. The credential is stored in iOS SecureStore. All other endpoints require Bearer authentication and a route-specific scope.

## Canonical endpoints

- `GET /api/v1/session`
- `GET /api/v1/games`
- `POST /api/v1/games`
- `GET /api/v1/games/{game_id}`
- `GET /api/v1/games/{game_id}/lineup-summaries`
- `GET /api/v1/games/{game_id}/current-hitter`
- `POST /api/v1/games/{game_id}/advance`
- `POST /api/v1/games/{game_id}/events`
- `GET /api/v1/opponents/{opponent_id}/hitters/{hitter_id}/card`
- `GET /api/v1/opponents/{opponent_id}/hitters/by-jersey/{jersey}/card`
- `POST /api/v1/telemetry`

The production app has no dependency on `/api/v1/opponents/{opponent_id}/hitter-summaries`.

`GET /session` must report contract `2026-08-17` and truthful `hitter_cards`, `game_setup`, `event_ingest`, `current_hitter`, `advance`, and `offline_event_queue` capabilities. Public request/response bodies contain no tenant/program IDs or internal score components.

## Game and event rules

`POST /games` creates or reuses a team-owned opponent game, with optional idempotent client game ID, date, venue, home/away, notes, and lineup. It uses Diamond's existing Game, DugoutLineup, and one live ChartingSession. Detail/current/advance derive from effective non-voided charting events rather than a parallel state table.

A called pitch is communication intent and creates no canonical statistic. A confirmed result becomes an ordered event with a stable ID. Diamond validates strict fields, tenant ownership, sequence, count-before, in-play requirements, runner semantics, and undo references. Batches keep valid events and return per-item rejections. A duplicate accepted ID is a successful no-op.

Supported results include ball, called/swinging strike, foul, foul bunt, HBP, in play, walk, strikeout, single/double/triple/home run, field out, fielder's choice, error, sacrifice fly, and sacrifice bunt. Existing runner events support stolen base and caught stealing. Diamond is authoritative for count and next hitter; the mobile client may only update optimistically.

Errors use:

```json
{"error":{"code":"validation_error","message":"Human-readable safe message."}}
```

Malformed, unauthorized, expired, revoked, cross-tenant, conflict, and rate-limit cases have stable codes and safe status values. External JSON is validated before entering UI state.

## Offline behavior

The app caches game/lineup scouting by device and game, with timestamp and no cross-team fallback. Confirmed events persist before send, retain order across restart, retry with exponential backoff, expose pending/failed status, and support explicit retry/discard. Unpair or revoked validation purges cache and queue. Room calling continues during a Diamond outage; the app never claims sync until Diamond accepts the event.

Any contract change requires an updated versioned fixture, Diamond OpenAPI compatibility tests, Expo client/runtime tests, Swift decoding fixtures, and cross-repository E2E.
