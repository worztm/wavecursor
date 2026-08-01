🌊 WaveCursor

Control your computer cursor with hand gestures in front of your webcam. Built with Wails v3 (Go backend), React and TypeScript (frontend), and Google MediaPipe hand tracking.

Works on Windows 10/11, macOS and Linux. Go 1.25, React 18, TypeScript 5.

Wave at your camera instead of reaching for the mouse — click, double-click, drag, right-click and scroll, all hands-free.

---

✨ What makes it special

- Full gesture vocabulary — move, click, double-click, drag and drop, right-click, and scroll, all from hand poses (see below).
- Works in the background — a small always-on-top panel keeps the camera running at full speed while you work in other apps; the cursor follows your hand everywhere.
- 3D pinch detection — pinch distances are measured with depth, so tilted hands still register correctly.
- Auto-calibrating thresholds — pinch sensitivity adapts to your open-hand resting distance, so hand size and camera distance don't matter.
- Accidental-click protection — clicks require the hand to have been open recently, so resting fists and stray finger curls never trigger one.
- Silky-smooth cursor — a 60 fps interpolator with short velocity prediction decouples cursor motion from detection frame rate.
- Two cursor mappings — switch between Absolute (finger = cursor, mirror-style) and Relative (move to steer) modes.
- Fully offline — the MediaPipe model and WASM runtime ship with the app; no CDN, no cloud, no tracking.
- Settings persist — sensitivity, response, dead zone, scroll speed and window options are remembered between runs.

🎯 Gestures

✋ Open hand (index finger out) .... Move cursor
👌 Pinch thumb + index, hold, release .... Left click (aim freely — the click fires on release)
👌 Pinch thumb + index twice, quickly .... Double click
🤏 Pinch thumb + index AND move the hand .... Drag and drop (the grabbed item follows your hand 1:1)
🫰 Pinch thumb + middle (index raised) .... Right click
🖖 Index + middle raised, move hand up / down .... Scroll

💡 Press Space to toggle tracking on or off at any time.

🖱️ Cursor mapping

Two modes, switchable from the panel:

- Absolute (default) — your index fingertip's position in the camera frame maps straight onto the desktop, mirror-style: move your hand to the top-right of the camera and the cursor goes to the top-right of your screen. The Sensitivity slider zooms the mapping for finer control.
- Relative — fingertip movement steers the cursor; hold still to stop. The Dead zone slider ignores small involuntary motions.

Click accuracy: pinch distances are measured in 3D (including depth), so a tilted hand still registers correctly, and the pinch thresholds auto-calibrate to your open-hand resting distance. A pinch that stays still is a click whenever you release it (aim freely); a pinch that moves becomes a drag.

📦 Requirements

- Runtime: Windows 10/11 (WebView2 ships with Windows), macOS, or Linux with a webcam
- Building from source: Go 1.25+, Node.js 20.19+ (or 22.12+), and the Wails v3 CLI

🚀 Run in development

wails3 dev

This starts the Vite dev server with hot reload and launches the app.

🔨 Build

wails3 build

Output: bin/wavecursor.exe on Windows, bin/wavecursor on macOS and Linux.

The frontend is embedded into the binary, so the result is a single self-contained executable — model and WASM runtime included.

🧠 How it works

1. The Wails window requests camera access (granted declaratively, so no prompt appears).
2. MediaPipe detects 21 hand landmarks per frame in the webview, at up to 60 fps.
3. The GestureEngine state machine classifies the pose and computes a target cursor position (absolute) or delta (drag).
4. React calls the Go CursorService over Wails bindings; the Go backend drives the real OS mouse.

Webcam → MediaPipe (WASM, GPU/CPU) → GestureEngine (state machine) → smoothed target / click / drag / scroll events → React UI → Wails bindings → Go CursorService → OS cursor APIs (user32 · CoreGraphics · XTest)

The window is always-on-top by default and Chromium background throttling is disabled (via WebView2 browser flags), so the webview keeps processing camera frames at full speed even while the window is covered by other apps. A watchdog interval in camera.ts additionally re-samples frames if requestAnimationFrame ever stalls. The cursor is driven by a 60 fps interpolator with short velocity prediction, so motion stays smooth even when a detection frame is late.

📁 Project layout

wavecursor/
├── main.go              — Wails app entry: window, always-on-top, camera permission
├── cursorservice.go     — Go service exposed to the frontend (cursor control)
├── internal/cursor/     — OS-specific mouse control (user32 / CoreGraphics / XTest)
└── frontend/
    ├── src/
    │   ├── App.tsx      — UI + pipeline wiring, 60fps interpolator
    │   ├── camera.ts    — webcam + MediaPipe HandLandmarker lifecycle
    │   ├── gestures.ts  — gesture state machine (move / click / drag / scroll)
    │   └── cursor.ts    — typed bridge to the Go CursorService
    └── public/
        ├── models/      — hand_landmarker.task (offline model)
        └── wasm/        — MediaPipe WASM runtime (offline, no CDN)

🩺 Troubleshooting

- "Could not start the camera" — check the webcam is connected and not in use by another app; on macOS grant camera permission in System Settings → Privacy & Security → Camera.
- Cursor feels jumpy — improve lighting and keep your hand roughly facing the camera. Lower Response for more smoothing.
- Gestures trigger accidentally — keep your hand open and relaxed while moving; fists and curled fingers are deliberately ignored.
- Tracking slows when the app is covered — the window must stay visible (always-on-top). Minimising pauses tracking because the OS throttles hidden webviews. Use compact mode (▣) and park the panel in a corner.
- Window covers what you're clicking — turn off Always on top, or use compact mode.

⚠️ Notes and limitations

- Works best with good, even lighting and your hand roughly facing the camera.
- On Linux, multi-monitor bounds are not yet merged (uses the primary display).
- Only one hand is tracked at a time (the most confident one).
- Wails v3 is still in alpha — expect occasional API churn.

📄 License

Released under the MIT License. See the LICENSE file at the repository root for details.
