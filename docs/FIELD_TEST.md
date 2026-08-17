# Two-iPhone / AirPods field gate

This checklist is the final human gate. Do not mark it passed from simulator, unit, mock, or synthetic automated evidence.

## Exact candidate

- Expo app: version `0.2.0`, iOS build `18`; EAS build `0e46e166-ea9d-4e41-8e5a-407298eb2c98` ([build record](https://expo.dev/accounts/chrisbaso/projects/dugoutcall/builds/0e46e166-ea9d-4e41-8e5a-407298eb2c98)). Internal TestFlight delivery remains blocked until the Apple Account Holder accepts the pending agreement.
- Diamond: branch Preview for `integration/dugoutcall-live`, contract `2026-08-17`, migration `e3d2f9f69976`.
- Backend: `https://dugoutcall.onrender.com`, Render deployment `dep-da1pf2rl550s73agktng`.
- Data: synthetic integration organization/game recorded in the release record; never use unapproved minor/player data.

## Preconditions

Use two physical iPhones: one Coach and one Catcher. Pair AirPods to the catcher. Install the same internal TestFlight candidate. Verify current league and venue rules allow electronic pitch calling. Confirm Diamond and backend health, then pair the coach phone with a newly generated Diamond code.

## One field session

- [ ] Select the exact synthetic/approved Diamond game and cache its lineup.
- [ ] Create a room; join from the catcher; confirm catcher has no Diamond data, composer, talkback, or acknowledgements.
- [ ] Run catcher test tone and TTS through AirPods; disconnect/reconnect AirPods and verify visible warning/recovery.
- [ ] Send at least 20 pitch/location calls; record perceived and measured latency, missed calls, duplicates, stale playback, and false delivery claims (must be none).
- [ ] Hold coach push-to-talk at least 10 times; record voice start latency; confirm the catcher hears voice and cannot publish audio back. Verify the 15-second cutoff.
- [ ] Record one complete PA with a mixture of outcomes; verify a call alone creates no Diamond event, while confirmed results update authoritative count and advance the hitter after resolution.
- [ ] Lose/restore Diamond connectivity; confirm calling continues, outcomes visibly queue, survive app restart, and later sync once without duplicates.
- [ ] Lose/restore room connectivity; confirm visible reconnect and no false sent state.
- [ ] Background/foreground both apps; confirm room/scouting/queue recovery.
- [ ] End the room; confirm cleanup and verify Diamond charting/report projection.

Record device models/iOS versions, network, AirPods model/firmware, pitch-call and voice latency, reconnect time, audio routing, battery/heat, usability notes, tester names, timestamp, and pass/fail evidence. Redact credentials and scouting content. Any wrong-team visibility, credential exposure, false delivery claim, duplicate statistical event, catcher talkback, or lost confirmed outcome is a stop-ship failure.
