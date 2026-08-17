# Diamond Scout client handoff

The only controlled-pilot client is `mobile/`, an Expo/React Native iOS app distributed through internal EAS/TestFlight. The SwiftUI package in `ios/` remains a contract-decoding reference and future consolidation option; it is not a second pilot product and does not need a parallel voice implementation.

## Pilot coordinates

- Branch: `integration/diamond-scout-live`
- Starting commit: `6c7db8ed7b50d8259c85028c415d5a4e55973e57`
- Contract: `docs/contracts/diamond-dugoutcall-2026-08-17.json`
- Expo SDK: 57
- App version: `0.2.0`
- iOS build number: `18`
- EAS project: `db0e8152-c984-4ea0-94ae-e0ef585059da`, owner `chrisbaso`

Production builds obtain `EXPO_PUBLIC_DIAMOND_SCOUT_URL` and `EXPO_PUBLIC_DUGOUTCALL_BACKEND_URL` from the EAS build profile. Ordinary users do not see API URL, bearer-token, opponent-ID, or internal-game-ID fields. Manual overrides exist only under `__DEV__`.

## Coach experience

First use is Coach → enter one-use Diamond pairing code → confirm team → select a real game → review lineup readiness → create room → share the six-digit catcher code → enter the combined scouting/call screen. Returning use validates the SecureStore credential, lists upcoming/in-progress games, and loads a device/game-scoped cache immediately while refreshing.

The live screen shows opponent/current hitter/on deck, jersey/bats, honest sample/confidence, a compact plan and up to three evidence-backed tags above the established pitch/location controls. “Limited data — pitch your strengths.” is the truthful no-data state. Pitch calling remains usable with cached or unavailable Diamond data.

Sending a call relays communication only. The optional outcome sheet records a confirmed ball, strike, foul/foul bunt, HBP, or in-play result. In-play requires PA result, batted-ball type, and field location. Events persist before submission and retry in order with stable IDs. Diamond's current-hitter/count response wins over optimistic state.

## Security and storage

The coach credential is stored in iOS SecureStore and is sent only from the coach app to Diamond over HTTPS. It is never sent to the room backend, LiveKit, or catcher. Unpair removes the credential and purges device-scoped scouting and queue data. Revocation/expiry blocks subsequent API requests and triggers safe local cleanup.

The catcher receives only short-lived room credentials, pitch/location relay messages, audio, and minimal health state. Catcher talkback, acknowledgements, message composer, and Diamond access remain disabled.

## Build and verification

From `mobile/`, run `npm ci`, `npm test`, `npm run typecheck`, `npx expo-doctor`, then an iOS Hermes export. The production candidate is `npx eas-cli@latest build --platform ios --profile production`; submit only to internal TestFlight, never public App Store release. The build profile must point at the approved Diamond Preview and controlled DugoutCall backend.

Swift models decode contract version `2026-08-17` including capabilities, nullable game dates, runner results, current hitter/on-deck, PA-start state, and event sequence. Compile/test them on the macOS GitHub Actions runner; Windows cannot validate SwiftUI.

Signed EAS build `0.2.0 (18)` is recorded at `https://expo.dev/accounts/chrisbaso/projects/dugoutcall/builds/0e46e166-ea9d-4e41-8e5a-407298eb2c98`. Apple must first accept the pending account agreement so this build can reach internal TestFlight. Then complete `docs/FIELD_TEST.md` on two physical iPhones with AirPods before enabling pilot staffs.
