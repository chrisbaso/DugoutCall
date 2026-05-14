# DugoutCall Mobile

This is the Expo/React Native iPhone app for DugoutCall. It is the publishable mobile path for TestFlight while the SwiftUI project remains the native reference implementation.

## Current Mobile MVP

- Coach creates a room against the hosted DugoutCall backend.
- Catcher joins with a six-digit code.
- Coach sends pitch/location calls.
- Catcher hears pitch calls with device text-to-speech.
- Catcher UI is listen-only in Game Mode.
- Push-to-talk uses native WebRTC audio in EAS/TestFlight builds. The coach mic streams one-way to the catcher phone while Hold Talk is pressed.

Default backend:

```text
https://dugoutcall.onrender.com
```

## Local Test

```bash
cd mobile
npm install
npm run start
```

Then open the project in Expo Go on an iPhone for UI and pitch-call testing. Native push-to-talk requires an EAS development/production build because `react-native-webrtc` includes custom native code and does not run inside Expo Go.

## TestFlight Build

1. Install and log into EAS CLI:

   ```bash
   npm install -g eas-cli
   eas login
   ```

2. Initialize/link the Expo project:

   ```bash
   cd mobile
   eas init
   ```

3. Confirm the iOS bundle identifier in `app.json`:

   ```text
   com.chrisbaso.dugoutcall
   ```

4. Create a production iOS build:

   ```bash
   eas build --platform ios --profile production
   ```

   Let EAS manage Apple credentials when prompted.

5. Submit the build to App Store Connect/TestFlight:

   ```bash
   eas submit --platform ios --profile production
   ```

Apple Developer/App Store Connect setup still needs an app record for `DugoutCall` with the same bundle identifier.

## Apple TestFlight Notes

- Push-to-talk needs two physical iPhones on the TestFlight build.
- The catcher iPhone should have AirPods selected as its current audio route before joining.
- WebRTC uses public STUN servers in the app. Some field/cellular networks may require adding a TURN server for more reliable live voice.
- First external TestFlight distribution may require beta review.
- Internal TestFlight testers are faster for the first field test.
- TestFlight builds expire after 90 days.
- AirPods must be paired to the catcher iPhone; the app cannot directly route to AirPods paired to another device.
