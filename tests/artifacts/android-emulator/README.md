# Android APK emulator verification — 2026-10-09

Result: **PASS**, `OK (1 test)`, 98.637 seconds. Tested the published
`webgame/downloads/weston-fit-quest-1.0.2.apk`, not a browser approximation.

- Dedicated Weston_Test_API35 AVD, Pixel 5 profile, Android 15 / API 35,
  Google APIs x86_64, WebView 124.0.6367.219, WHPX acceleration.
- Actual Capacitor native bridge initializes; Start becomes enabled.
- Actual OpenStreetMap road tiles load on the run screen and saved summary.
  Screenshot review confirms roads and the red GPS route together.
- Emulator GPS console supplies synthetic movement to the actual native service.
  Pause excludes new fixes; resume records a new segment with numbered P1/R1 markers.
- GPS fixes continue during 10 seconds on the launcher and 8 seconds with the
  emulated screen off. PowerManager confirms the screen is noninteractive.
- Finish persists one record with 13 route points, two pause/resume events,
  122.129 metres and 37.914 active seconds; summary displays that saved route.
- Supabase fetches are blocked during the synthetic workout. Pending local fixture
  data is cleared from the dedicated emulator after evidence is pulled.
  This run does not verify online synchronization.

Evidence: `instrumentation.txt`, `logcat.txt`,
`files/emulator-map-ready.png`, `files/emulator-saved-route.png`,
`files/emulator-map-diagnostics.json`, `files/emulator-record.json`.
All six summary tile images completed with natural width 256.

APK SHA256:
`d82a12f08b01924e184c5f7b9d6728628a55fb78d47e4b6f1b97d663719c5c48`.
Local port 8080 download HEAD returned HTTP 200.

Repeat: build `:app:assembleDebugAndroidTest`, boot Weston_Test_API35, then run
`mobile/scripts/test-emulator.py --sdk-root <Android SDK>` with Python.
The driver refuses physical devices and other AVD names before clearing fixtures.

Limits: short simulated outdoor run only. Physical phone GPS, long screen lock,
manufacturer battery restrictions, treadmill sensors, iOS and cloud upload are
not established by this test. P/R text is readable but sits near the marker edge.
