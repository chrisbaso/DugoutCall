# Diamond Scout × DugoutCall integration

The canonical work record is maintained in Diamond Scout at `docs/diamond-dugoutcall-integration.md`. This repository supplies the Expo coach/catcher client, room backend, LiveKit credentials/voice, diagnostics, and coach-device offline queue.

Release coordinates:

- Diamond start `8f997a13c8b26522aaf0838048670927e3035130`, branch `integration/dugoutcall-live`
- DugoutCall start `6c7db8ed7b50d8259c85028c415d5a4e55973e57`, branch `integration/diamond-scout-live`
- Contract `2026-08-17`
- Canonical client `mobile/`, Expo SDK 57, app `0.2.0`, iOS build `16`
- Diamond remains the user/team/game/scouting/charting authority; the communications service stores no Diamond credential or scouting aggregate

A sent call is intent. Only a separately confirmed outcome is persisted into Diamond's canonical charting projection. The catcher receives room-only state and remains listen-only. Roll back the communications server/mobile independently to the last passing controlled build; roll back Diamond to its prior Preview without targeting production. See `docs/PILOT_RELEASE.md`, `docs/FIELD_TEST.md`, and `docs/INTEGRATION_API.md`.
