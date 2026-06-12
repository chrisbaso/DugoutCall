# Diamond Scout / DugoutCall Integration API

This is the canonical contract for the Diamond Scout side of the DugoutCall
integration. It is shared by both repos.

Surface 3, the DugoutCall iPad coach app, depends on this API for two things:

- Reading game-ready hitter scouting cards.
- Writing live pitch-call and outcome events back into the same charting event
  stream used by Diamond Scout's native charting workflow.

The integration is additive. It must reuse existing Diamond Scout services and
aggregates, preserve tenant isolation, and avoid introducing a separate
pitch-call data model.

## Status

Phase 0 audit findings, as of this contract revision:

- The repo does not yet implement `/api/v1`.
- The repo uses `get_current_tenant()` and `scoped_select(...)` as the current
  tenant choke point. Older docs and prompts may say `get_current_team()`; for
  this codebase the API auth dependency must resolve a `Tenant`, set
  `session.info["tenant_id"]`, and then use the same tenant-scoped query path.
- `ChartingEvent.pitch_location` exists and is nullable.
- Server-authoritative count resolution exists in `app.services.charting_count`
  and is enforced by `sync_charting_events(...)`.
- `event_id` in this API maps to `charting_events.client_event_id`; idempotency
  is scoped to one game's charting session.

## Non-Negotiables

- Base path is `/api/v1`.
- All endpoints require Bearer-token authentication.
- The Bearer token resolves to exactly one tenant/program.
- Tenant/program ids never appear in URLs, request bodies, or response bodies.
- Every read and write is scoped through the token-resolved tenant.
- Opponent ids, game ids, and hitter ids are allowed in URLs and responses only
  after they have been verified inside the token tenant.
- Do not create a new pitch-call event table or aggregate.
- Do not expose internal danger scores, raw z-scores, or score components.
- Do not fabricate confidence. Low-sample and confidence fields must come from
  the existing shrinkage/report layers.
- Catcher-side visuals are out of scope. DugoutCall relay remains comms-only.

## Authentication

Requests include:

```http
Authorization: Bearer <diamond_scout_api_token>
```

Token behavior:

- Tokens are issued from the Diamond Scout settings surface for the current
  tenant/program.
- The raw token is displayed once. Stored server-side tokens must be stored as a
  secret or hash, not echoed back by API responses.
- A valid token resolves to the same tenant object used by the web app's
  `get_current_tenant()` path.
- API auth must set the session's tenant context before creating rows so the
  tenant flush hook fills `tenant_id` consistently.
- Missing, malformed, expired, revoked, or unknown tokens return `401`.
- Valid tokens attempting to access another tenant's opponent/game/hitter return
  `404`, not cross-tenant metadata.

Auth error shape:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid API token."
  }
}
```

## Shared Response Rules

- JSON only.
- Timestamps use ISO 8601 strings.
- Dates use `YYYY-MM-DD`.
- Empty optional strings are returned as `null` or omitted, not `""`, unless a
  nested existing service payload already uses string display values.
- Validation errors return `400`.
- Not-found or cross-tenant access returns `404`.
- Unexpected errors return `500`.

Validation error shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "field_location is required for in_play contact.",
    "field": "events[2].field_location"
  }
}
```

## Enums

### Pitch Results

Canonical values:

- `ball`
- `called_strike`
- `swinging_strike`
- `foul`
- `foul_bunt`
- `in_play`
- `hbp`

### PA Actions

- `intentional_walk`

### PA Results

Canonical values:

- `walk`
- `strikeout`
- `hbp`
- `single`
- `double`
- `triple`
- `home_run`
- `field_out`
- `fielders_choice`
- `error`
- `sac_fly`
- `sac_bunt`

### Strikeout Manners

- `looking`
- `swinging`
- `bunt`

### Batted Ball Types

- `GB`
- `LD`
- `FB`
- `PU`
- `Bunt`

### Field Locations

Canonical values accepted by the charting service:

- `left_side`
- `third_base`
- `shortstop`
- `lf_line`
- `left_field`
- `left_center`
- `middle`
- `center_field`
- `right_center`
- `right_field`
- `rf_line`
- `right_side`
- `second_base`
- `first_base`

The existing service accepts common aliases (`left`, `3B`, `SS`, `CF`, `RF`,
and similar) and normalizes them. API docs and examples should use canonical
values.

### Field Depth

- `infield`
- `shallow`
- `normal`
- `deep`
- `wall`
- `unknown`

### Pitch Locations

Canonical values:

- `inside`
- `away`
- `up`
- `down`
- `middle`
- `up_in`
- `up_away`
- `down_in`
- `down_away`

### Runner Results

- `SB`
- `CS`

### Confidence

Report/tier confidence:

- `thin`
- `moderate`
- `good`

API/UI confidence key:

- `limited`
- `moderate`
- `high`

### Tiers

- `t1`
- `t2`
- `t3`
- `low`

## Count Resolution

The server is authoritative. The client can run the shared rule file
optimistically, but server sync wins.

Canonical rule artifact:

```text
app/static/charting-count-rules.json
```

Rules:

- `ball`: balls plus one; ball four resolves `walk`.
- `called_strike`: strikes plus one; strike three resolves `strikeout` with
  `strikeout_manner = "looking"`.
- `swinging_strike`: strikes plus one; strike three resolves `strikeout` with
  `strikeout_manner = "swinging"`.
- `foul`: strike plus one only when strikes are below two. With two strikes, the
  count is unchanged and no strikeout is recorded.
- `foul_bunt`: with two strikes, resolves `strikeout` with
  `strikeout_manner = "bunt"`; otherwise strikes plus one.
- `in_play`: resolves from the supplied batted-ball PA result and requires
  `batted_ball` plus `field_location`.
- `hbp`: resolves `hbp` regardless of count.
- `intentional_walk`: resolves `walk` without requiring four balls and does not
  add a pitch.
- Counts never exceed `3-2` before a PA is resolved.
- A pitch or PA action after a resolved PA is invalid.

Override rules:

- Overrides are stored as correction/PA result events, not updates.
- An override must reference a PA already resolved by the count rules.
- Overrides may change the batter-safe PA result, such as dropped-third-strike
  reached by error.
- Strikeout attribution and `strikeout_manner` remain only when the resolved
  count path was a strikeout and the override carries the matching manner.

## Endpoints

### GET `/api/v1/session`

Returns API session metadata for the token tenant.

Response:

```json
{
  "schema_version": "2026-06-10",
  "program": {
    "name": "Diamond Scout",
    "season": "2026"
  },
  "capabilities": {
    "hitter_cards": true,
    "game_setup": true,
    "event_ingest": true,
    "current_hitter": true,
    "advance": true,
    "offline_event_queue": true
  },
  "count_rules_version": "2026-06-03",
  "enums": {
    "pitch_results": ["ball", "called_strike", "swinging_strike", "foul", "foul_bunt", "in_play", "hbp"],
    "pa_actions": ["intentional_walk"],
    "pa_results": ["walk", "strikeout", "hbp", "single", "double", "triple", "home_run", "field_out", "fielders_choice", "error", "sac_fly", "sac_bunt"],
    "pitch_locations": ["inside", "away", "up", "down", "middle", "up_in", "up_away", "down_in", "down_away"]
  }
}
```

Mapping:

- `program` maps to the token-resolved `Tenant`, without exposing its id.
- `count_rules_version` maps to `app/static/charting-count-rules.json`.

### GET `/api/v1/opponents`

Lists opponent teams scoped to the token tenant.

Response:

```json
{
  "opponents": [
    {
      "id": 70,
      "name": "Edina Hornets 14AAA",
      "season": "2026",
      "game_count": 4,
      "hitter_count": 12,
      "charted_game_count": 2
    }
  ]
}
```

Mapping:

- `id`, `name`, `season` map to tenant-scoped `Team` where `is_our_team` is
  false.
- Counts are derived from tenant-scoped `Game`, `Player`, and
  `ChartingSession` rows.

### GET `/api/v1/games`

Lists API-visible games for the token tenant.

Optional query params:

- `opponent_id`
- `status`
- `date_from`
- `date_to`

Response:

```json
{
  "games": [
    {
      "id": 101,
      "opponent_id": 70,
      "opponent_name": "Edina Hornets 14AAA",
      "game_date": "2026-06-10",
      "home_away": "Away",
      "location": "Edina",
      "status": "in_progress",
      "charting_session_id": 55,
      "lineup_count": 9
    }
  ]
}
```

`charting_session_id` is returned for diagnostics only. DugoutCall should use
`game_id` and `event_id`; it must not post `charting_session_id`.

### POST `/api/v1/games`

Creates or reuses a live game context for DugoutCall.

Request:

```json
{
  "opponent_id": 70,
  "client_game_id": "dugoutcall-2026-06-10-edina",
  "game_date": "2026-06-10",
  "home_away": "Away",
  "location": "Edina Varsity Field",
  "expected_pitcher_ids": [31],
  "lineup": [
    {
      "slot": 1,
      "hitter_id": 4,
      "jersey": "4",
      "notes": "Hold runners 1-0."
    }
  ],
  "notes": "Section semifinal."
}
```

Field rules:

- `opponent_id` is required and must belong to the token tenant.
- `client_game_id` is optional. If provided, a repeated request with the same
  token and `client_game_id` must be idempotent.
- `game_date`, `home_away`, `location`, and `notes` map to `Game`.
- `lineup` is optional. When present it stores the projected order using the
  existing dugout lineup mechanism for that game.
- `expected_pitcher_ids` is accepted for the Prep-to-Live bridge but may be
  stored only as notes until pitcher-specific prep is implemented.

Response:

```json
{
  "game": {
    "id": 101,
    "opponent_id": 70,
    "opponent_name": "Edina Hornets 14AAA",
    "game_date": "2026-06-10",
    "home_away": "Away",
    "location": "Edina Varsity Field",
    "status": "in_progress"
  },
  "charting": {
    "source": "live",
    "status": "in_progress"
  },
  "lineup": [
    {
      "slot": 1,
      "hitter_id": 4,
      "jersey": "4",
      "name": "Isaiah Kelly",
      "notes": "Hold runners 1-0."
    }
  ]
}
```

Mapping:

- `Game.opponent_team_id = opponent_id`.
- Exactly one API live `ChartingSession` should be used for one API game.
- Existing `create_charting_session(...)` can create the session, but Phase 1
  needs an idempotent lookup/reuse wrapper so repeated game setup does not
  create duplicate live sessions.
- Existing `DugoutLineup` can store lineup order, but it currently stores
  subject keys rather than hitter ids; implementation must bridge those cleanly.

### GET `/api/v1/games/{game_id}`

Returns a single game context and its current API state.

Response:

```json
{
  "game": {
    "id": 101,
    "opponent_id": 70,
    "opponent_name": "Edina Hornets 14AAA",
    "game_date": "2026-06-10",
    "home_away": "Away",
    "location": "Edina Varsity Field",
    "status": "in_progress"
  },
  "lineup": [
    {
      "slot": 1,
      "hitter_id": 4,
      "jersey": "4",
      "name": "Isaiah Kelly",
      "notes": "Hold runners 1-0."
    }
  ],
  "event_summary": {
    "accepted_events": 12,
    "plate_appearances": 3,
    "last_event_id": "dc-evt-0012"
  }
}
```

### GET `/api/v1/opponents/{opponent_id}/hitters/{hitter_id}/card`

Returns one hitter card for the requested opponent.

Optional query params:

- `game_id`: scopes game-specific edits/notes and selected game aggregates.

Response:

```json
{
  "schema_version": "2026-06-10",
  "opponent": {
    "id": 70,
    "name": "Edina Hornets 14AAA",
    "season": "2026"
  },
  "game_id": 101,
  "hitter": {
    "id": 4,
    "name": "Isaiah Kelly",
    "display_name": "#4 Isaiah Kelly",
    "jersey": "4",
    "bats": "R"
  },
  "tier": {
    "key": "t1",
    "label": "Tier 1 - Handle with care"
  },
  "confidence": {
    "level": "good",
    "key": "high",
    "label": "Good confidence",
    "low_sample": false,
    "pa_sample": 70,
    "charted_bip": 18,
    "spray_level": "moderate",
    "spray_label": "Moderate confidence"
  },
  "plan": {
    "out_plan": "Attack the zone; do not give free bases.",
    "pitch_plan": "Pound away until he adjusts.",
    "coach_note": "Hold runners 1-0."
  },
  "quick_stats": {
    "pa": "70",
    "ab": "60",
    "avg": ".333",
    "obp": ".421",
    "slg": ".500",
    "ops": ".921",
    "bb": "8",
    "k": "10",
    "k_pct": "14%",
    "bb_pct": "11%",
    "sb": "5",
    "cs": "1",
    "bunt": "2",
    "first_pitch": "40%",
    "contact": "GB 40 / FB 35 / LD 20 / PU 5"
  },
  "chips": [
    { "text": "K 14%", "kind": "" },
    { "text": "BB 8", "kind": "" },
    { "text": "SB 5", "kind": "run" }
  ],
  "defense": {
    "sample_size": 18,
    "confidence": "High",
    "confidence_code": "+",
    "gb_lcr": [45, 35, 20],
    "air_lcr": [25, 45, 30],
    "if_call": "SS hole",
    "of_call": "CF shade",
    "pull_oppo": "Pull",
    "field_fan_svg_dark": "<svg ...></svg>",
    "field_fan_svg_light": "<svg ...></svg>"
  },
  "running": {
    "speed": "+",
    "stolen_bases": 5,
    "bunt": "Y",
    "bunt_count": 2
  },
  "next": [
    { "slot": 2, "hitter_id": 8, "display_name": "#2 Strey" }
  ]
}
```

Mapping:

- Hitter identity maps to tenant-scoped `Player` where
  `Player.team_id == opponent_id`.
- Defensive fields map to a row from
  `build_defensive_grid_payload(session, opponent_id, game_id=..., layout="ipad",
  lineup_mode="all")` and the existing `render_field_fan(...)` helper.
- Tier, confidence, chips, and out plan map to
  `build_scouting_report_payload(...)[ "report_design" ]`.
- `pitch_plan` and coach notes map to existing `PocketCardEdit` values.
- The response must not include any key named `score`, `danger_score`,
  `raw_score`, `z`, or `components`.

### GET `/api/v1/opponents/{opponent_id}/hitters/by-jersey/{jersey}/card`

Same response as the hitter-id card endpoint.

Rules:

- `jersey` is matched against tenant-scoped `Player.jersey_number` for the
  requested opponent.
- If more than one active hitter in the opponent roster has the same jersey,
  return `409` with an ambiguity error.

### GET `/api/v1/games/{game_id}/current-hitter`

Returns the hitter Diamond Scout believes is active for a game.

Response:

```json
{
  "game_id": 101,
  "lineup_slot": 4,
  "plate_appearance_key": "g101-pa-4",
  "hitter_id": 4,
  "count": {
    "balls": 2,
    "strikes": 1,
    "label": "2-1"
  },
  "card": {
    "...": "same schema as hitter card"
  },
  "next": [
    { "slot": 5, "hitter_id": 8, "display_name": "#8 Holk" }
  ]
}
```

Mapping:

- Current hitter state is derived, not stored in a new table.
- Derivation uses the game lineup plus effective, non-voided charting events in
  the game's API live `ChartingSession`.
- If there are no events, return lineup slot 1.
- If the current PA is resolved, return the next lineup slot.
- If lineup is missing, fall back to the first hitter returned by the existing
  dugout hitter order.

### POST `/api/v1/games/{game_id}/advance`

Advances the derived current hitter to another lineup slot and returns the new
current hitter card.

Request:

```json
{
  "event_id": "dc-advance-0004",
  "direction": "next",
  "lineup_slot": 5,
  "hitter_id": 8,
  "reason": "Auto advance after resolved PA"
}
```

Field rules:

- `event_id` is required and idempotent within the game charting session.
- `direction` may be `next` or `previous`. Default is `next`.
- `lineup_slot` and `hitter_id` are optional override targets for corrections.
- The endpoint must not create a separate game-state table.

Mapping:

- The preferred implementation is to append or reuse a `pa_start` charting event
  for the target hitter using the same event idempotency rules as
  `POST /events`.
- If a PA start already exists for `event_id`, return it as a no-op.

Response:

```json
{
  "advanced": true,
  "event_id": "dc-advance-0004",
  "lineup_slot": 5,
  "hitter_id": 8,
  "plate_appearance_key": "g101-pa-5",
  "card": {
    "...": "same schema as hitter card"
  }
}
```

### POST `/api/v1/games/{game_id}/events`

Ingests a single charting event or a batch of charting events for one game.

Single-event request:

```json
{
  "event_id": "dc-evt-0001",
  "sequence": 1,
  "type": "pa_start",
  "pa_key": "g101-pa-1",
  "lineup_slot": 1,
  "batter_id": 4,
  "pitcher_id": 31
}
```

Batch request:

```json
{
  "events": [
    {
      "event_id": "dc-evt-0001",
      "sequence": 1,
      "type": "pa_start",
      "pa_key": "g101-pa-1",
      "lineup_slot": 1,
      "batter_id": 4,
      "pitcher_id": 31
    },
    {
      "event_id": "dc-evt-0002",
      "sequence": 2,
      "type": "pitch",
      "pa_key": "g101-pa-1",
      "pitch_sequence": 1,
      "count_before": "0-0",
      "pitch_type": "Fastball",
      "pitch_location": "away",
      "result": { "kind": "called_strike" }
    }
  ]
}
```

Response:

```json
{
  "accepted": 2,
  "rejected": []
}
```

Rejected response example:

```json
{
  "accepted": 1,
  "rejected": [
    {
      "event_id": "dc-evt-0003",
      "index": 3,
      "reason": "in_play requires batted_ball and field_location"
    }
  ]
}
```

Idempotency:

- `event_id` maps to `charting_events.client_event_id`.
- Re-posting the same `event_id` to the same game charting session is a
  successful no-op.
- Duplicate events are not counted as accepted and are not rejected.
- The same `event_id` posted to a different game is independent.

Adapter mapping to `sync_charting_events(...)`:

| API field | Charting service field |
|---|---|
| `event_id` | `client_event_id` |
| `sequence` | `event_sequence` |
| `type` | `event_type` |
| `pa_key` | `plate_appearance_key` |
| `lineup_slot` | `lineup_slot` |
| `batter_id` | `batter_id` |
| `pitcher_id` | `pitcher_id` |
| `runner_id` | `runner_id` |
| `pitch_sequence` | `pitch_sequence` |
| `count_before` | `count_before` |
| `pitch_type` | `pitch_type` |
| `pitch_location` | `pitch_location` |
| `result.kind` for `pitch` | `pitch_result` |
| `result.kind` for `pa_action` | `pa_action` |
| `result.kind` for `pa_result` | `pa_result` |
| `result.override` | `pa_result_override` |
| `result.strikeout_manner` | `strikeout_manner` |
| `batted_ball` | `batted_ball_type` |
| `field_location` | `field_location` |
| `field_depth` | `field_depth` |
| `landing.x_pct` | `landing_x_pct` |
| `landing.y_pct` | `landing_y_pct` |
| `contact_quality` | `contact_quality` |
| `runner_result` | `runner_result` |
| `bunt_attempt` | `bunt_attempt` |
| `voids_event_id` | resolved to `voids_event_id` by prior API `event_id` |
| `notes` | `notes` |

Event type rules:

- `pa_start` requires `event_id`, `sequence`, `pa_key`, `batter_id`, and
  `pitcher_id`.
- `pitch` requires `event_id`, `sequence`, `pa_key`, `pitch_sequence`,
  `count_before`, and `result.kind`.
- `pitch.result.kind == "in_play"` requires a batted-ball PA result plus
  `batted_ball` and `field_location`, either on the pitch event or a contact
  event before the terminal PA result.
- `contact` requires `batted_ball` plus `field_location`, or `landing.x_pct` and
  `landing.y_pct` from which Diamond Scout can derive location/depth.
- `pa_action` requires `result.kind == "intentional_walk"`.
- `pa_result` requires `result.kind`.
- `runner` requires `runner_id` and `runner_result`.
- `bunt` requires `bunt_attempt == true` or a `Bunt` contact event.
- `undo` and `correction` must reference a prior API `event_id` in the same game
  session.

Example in-play sequence:

```json
{
  "events": [
    {
      "event_id": "dc-pa1-start",
      "sequence": 1,
      "type": "pa_start",
      "pa_key": "g101-pa-1",
      "lineup_slot": 1,
      "batter_id": 4,
      "pitcher_id": 31
    },
    {
      "event_id": "dc-pa1-p1",
      "sequence": 2,
      "type": "pitch",
      "pa_key": "g101-pa-1",
      "pitch_sequence": 1,
      "count_before": "0-0",
      "pitch_type": "Fastball",
      "pitch_location": "away",
      "result": { "kind": "in_play", "pa_result": "double" },
      "batted_ball": "LD",
      "field_location": "left_center",
      "field_depth": "deep"
    }
  ]
}
```

The API adapter may split a combined in-play pitch payload into the flat service
fields accepted by `sync_charting_events(...)`; downstream projection must be
indistinguishable from native charting.

## Projection And Roll-Up

Accepted API events flow into the existing charting service and then into the
existing projection:

- `charting_events`
- `PlateAppearance`
- `Pitch`
- `BattedBall`
- `BoxScoreRow`

The report and card readers continue to consume:

- `build_scouting_report_payload(...)`
- `build_defensive_grid_payload(...)`
- existing `PocketCardEdit` coach notes and pitch plans

There is no DugoutCall-specific aggregate.

## Privacy And Leakage Tests

Required tests:

- Token for tenant A cannot list tenant B opponents.
- Token for tenant A cannot create/read a game for tenant B.
- Token for tenant A cannot fetch a tenant B hitter card by id or jersey.
- Token for tenant A cannot write events against tenant B game ids.
- Hitter card payload contains no key named `score`, `danger_score`,
  `raw_score`, `z`, or `components`.
- Hitter card payload does not leak unrelated player names beyond the requested
  card and its `next` lineup preview.

## Contract Tests Required Before Done

- `GET /session` returns the contract schema and enum values.
- `GET /opponents` is tenant scoped.
- `POST /games` creates or reuses a game and API charting session.
- `GET /games/{id}` returns only tenant-scoped game state.
- Hitter-card payload matches this contract exactly for id and by-jersey lookup.
- Card payloads reuse existing services and preserve honest confidence/low
  sample fields.
- `POST /games/{game_id}/events` accepts single events and `{ "events": [...] }`.
- Accepted pitch-call events roll up into the same report aggregates used by
  Diamond Scout.
- Re-posting the same `event_id` is a no-op.
- Inconsistent count sequences are rejected.
- `in_play` without batted-ball result and field location is rejected.
- No new pitch-call data model is introduced.
- No internal danger scores appear.
