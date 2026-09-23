# Phone media and responsiveness

Current work: repair video playback, add smooth photo expansion, and reduce friction and rendering work in the phone's main browsing flow. Preserve the existing library and nav animation.

- Video: reproduced a stalled H.264 MP4 in the emulator and a file-reading error on the owner's phone. WebView applies byte ranges itself; removing the second skip passes real playback, seek and resume in the emulator.
- Photos: expanded viewer supports pinch, pan, double-tap/reset, short-swipe snap-back, swipe up/down dismissal, keyboard and Android Back. Phone touch checks passed.
- Controls: native video controls only; removed the overlapping custom Play button. Details open/close with a reversible animation. Top Recent/Notes and bottom navigation both have travelling selections.
- Motion: cards expand from their grid positions; Home stays mounted and inert behind item screens. The home panel now moves as one piece, with no card stagger, padding jump or changing radius. Owner requested a slightly faster final timing: 600 ms in both directions.
- Verification: phone media/nav checks passed; library (23), sync (16), source desktop UI (13), Windows installer build and packaged UI (13) passed earlier in this work. Later changes are phone-only. Android 0.5.10 (code 15) built and installed; APK is `dist/Notebook-phone-0.5.10.apk`.
- Physical evidence: `test-output/phone-video/physical-057.json` verifies native Play tap, seeking, animated details, both swipe dismissals and unchanged library contents. `lift-059.json` verifies all cards stay fixed within the moving panel in both directions. One cold upward pass still recorded a 75 ms frame interval; subsequent up/down passes were 8-17 ms. These short samples do not establish hitch-free performance everywhere.

Permission: the owner explicitly allowed phone testing after initially asking us not to. Target only `192.168.0.210:33861` for physical-device checks.

Recoverable baseline of uncommitted UI/build files: `C:\Users\abdul\AppData\Local\Temp\notebook-media-baseline-20260923-082511`. MainActivity also has a committed baseline.

## 0.6 repair (Claude)
- Fixed: Home's board wheel drew over every other screen (each screen is now its own layer; Home is hidden with `visibility`, keeping its scroll).
- Fixed: duplicate boards from the first pairing (`Library.dedupeBoards` merges same-name boards and tombstones the empty twin; `adoptBoards` stops it on new pairings). Verified on the phone and PC: 7 boards each.
- Photos and videos fly between their card and the open screen, and the full-screen viewer grows from the photo. Viewer text buttons/hints replaced by one back button (double-tap resets zoom). Wheel glow restored.
- Verified: test-phone-nav, test-phone-media, and a screen recording on the phone.
