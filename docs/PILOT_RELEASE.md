# DugoutCall integrated pilot release

Status: internal candidate. Automated implementation is complete; exact managed deployments, CI, EAS/TestFlight, and physical field evidence are appended as gates finish. Public launch is disabled.

## Coordinates

- Branch: `integration/diamond-scout-live`; start `6c7db8ed7b50d8259c85028c415d5a4e55973e57`
- Paired Diamond branch: `integration/dugoutcall-live`; start `8f997a13c8b26522aaf0838048670927e3035130`
- Contract: `2026-08-17`
- Mobile: Expo SDK 57, app `0.2.0`, iOS build `16`, EAS project `db0e8152-c984-4ea0-94ae-e0ef585059da`
- Backend baseline: `https://dugoutcall.onrender.com`; use only after the candidate deploy passes the controlled staging checks below

## Mobile build and TestFlight

Install with the committed lockfile, run mobile tests/typecheck, Expo Doctor, and Hermes iOS export, then build the `production` EAS profile with `EXPO_PUBLIC_DIAMOND_SCOUT_URL` set to the approved Diamond Preview and `EXPO_PUBLIC_DUGOUTCALL_BACKEND_URL` set to the controlled backend. No URL/token override is visible outside `__DEV__`. Submit only to named internal TestFlight testers; do not select public App Store release.

An Apple/EAS interactive credential prompt is an authorized external boundary. Preserve/push all work and report the one exact approval required if the current session cannot complete it.

## Backend deploy and verification

Deploy the branch to an isolated preview/staging service, or verify the existing Render service has no conflicting production use before updating it. Required environment names are `PORT`, `CORS_ORIGINS`, and `DUGOUTCALL_TOKEN_SECRET`; optional voice credentials are `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. Room diagnostics are protected by the same signed, role-bound room credential and do not use a separate diagnostics secret. Never put Diamond URLs, credentials, or scouting data in the backend.

Verify HTTPS/WSS, `/health`, room create/join, six-digit code and TTL, create/join IP rate limits, signed role-bound/expiring room tokens, one coach/one catcher, reconnect, expired-room failure, protected/redacted diagnostics, and missing-LiveKit warning. A staging backend without LiveKit credentials can validate pitch relay but cannot pass the voice field gate.

Run the credential-safe live-service check with `node integration/live-backend-smoke.mjs https://your-backend.example`. It emits booleans only and never prints room or LiveKit credentials.

Recovery: stop new rooms, roll back to the last passing server build, preserve only redacted room diagnostics, rotate room/diagnostic/LiveKit secrets if exposure is suspected, and repeat auth/relay/reconnect/voice-token tests. No room state is a scouting/stat database.

## Operational readiness

Pregame coach checks: backend reachable, Diamond reachable or cache present, game selected, scouting cached, room created, catcher joined, socket connected, LiveKit connected, and microphone permission. Catcher checks: room/socket joined, AirPods route, test tone, TTS, LiveKit subscribed, and emergency disconnect. Staff see Ready/Warning/Blocked; detailed diagnostics stay operator-only.

During network trouble, Diamond outcomes remain visibly queued and room calling continues. During room trouble, the app shows disconnected/reconnecting and never claims delivery. The queue must read Synced before postgame closeout.

Known risks include physical Bluetooth/audio-route behavior not reproducible in automation, LiveKit provider configuration, and upstream Expo/Metro build-tool advisories. The pilot uses the SDK 57 `expo-audio` module; league rules differ, and the club is responsible for verifying electronic communication is permitted.

## Release evidence

Append exact branch SHAs, linked draft PRs, CI run URLs, Diamond Preview, backend deployment, EAS build ID/URL, internal TestFlight status, automated test totals, and the signed `docs/FIELD_TEST.md` evidence before enabling the three pilot staffs. No billing, Android, HQ, GameChanger automation, catcher talkback/acknowledgements, or public launch is part of this release.
