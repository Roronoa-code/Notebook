# Phone 0.14.1 continuation

Claude was asked directly on 26 September 2026 in a fork of its Notebook session. This is its handoff, to be checked against the working tree. The baseline is commit `71327d6`; the owner's existing AGENTS.md edits must be preserved.

## Delivery ledger

- [x] Shared phone timing, corners, secondary text and press feedback; consistent side margins and usable touch targets.
- [x] Floating sheets: backdrop, touch drag, cancellation, reversal and dismissal; remove the inert note handle and add a handle to the draggable media title bar.
- [x] Verify Back order, gallery scroll retention, visible actions, and all five phone suites.
- [x] Re-verify viewer plus floating sheets with Android emulator input and inspect rendered frames.
- [x] Complete required project checks, record exact failures or environmental limits.
- [x] Build phone 0.14.1 (36), install on the owner's identified phone, and retain APK.
- [x] Update the file map and commit only this work, preserving owner's unrelated edits.

## Follow-up usability findings

The owner reported the Home background picker trapping them after 0.14.0 was installed. The earlier gesture checks covered dismissal but did not use a large enough cover list to exercise touch scrolling. The `touch-action: none` on the whole popup prevented native scrolling. This is a regression in the consistency pass and is included in 0.14.1 (36).

- Background picker: a bounded, scrollable list; a visible Done button; native lazy thumbnail loading; selection updates in place without jumping to the top. Drag dismissal belongs to the header, while the image list belongs to the browser's scroller.
- Other forms: bounded by the available viewport and allowed to scroll.
- Notes with many boards: the board panel previously overlapped the editor. The editor and board panel now share a flex layout, with the board list scrolling and actions staying visible.
- Zoomed photos: Back stays visible. The visible button and Android Back use the same order: zoom out, close Details, then return to the grid.
- Viewer swipes: fixed the neighbour-direction lookup which incorrectly resisted dragging towards an available next picture.

## Project checks, 26 September 2026

- Library: 32 passed; sync: 20 passed; desktop UI: 32 passed; features: 13 passed; ad filter passed; screenshot audit completed without script errors.
- The desktop stack test had a stale fixed delay. It now waits for the completed unstack state before pressing Escape; no desktop product code changed.
- Windows 2.4.0 installer rebuilt successfully and packaged UI: 32 passed. No desktop installation or version change.
- Public link fixtures: 20/20 saved and playable offline; Pinterest and Ideas: all 9 checks passed, using isolated test state.
- Suggestions evaluation completed on 219 public fixtures: 5 outfit groups and 3 matching sets. This is an execution check, not a new subjective quality rating.
- `test-recognition.js` is stale: it imports the removed `nameFrom` helper and fails before completing its report. A separate read-only scoring run using the current recogniser passed types 36/40, colours 17/20 and styles 17/20. No recognition product changes were made for this phone task.
- The initial 0.14.0 build passed all five phone suites and the Android emulator viewer journey. The follow-up checks for 0.14.1 add real touch scrolling with long cover/board lists and visible Back while zoomed; final results follow below.

The owner's physical phone is used only for the authorised APK installation and package-version readback. Interactive verification uses the mock bridge and the isolated Android emulator, never the owner's library.

## Final verification and delivery

- All five phone suites passed. The background regression uses 100 extra photo records, real CDP touches, separate-row geometry checks, scroll retention after selection, Done, Android Back and drag dismissal. The note regression verifies editor clearance, touch scrolling and Done with 34 boards. Photo Back is tested while zoomed and while Details is open.
- Final Android emulator journey passed with 105 test photos: scroll the background list, choose a visible picture without resetting position, close with Done and system Back, edit a note with many boards and leave with Done. Screenshots were inspected: `test-output/emu0141/cover-scrolled.png` and `note-many-boards.png`.
- The first large-list visual check exposed shrinking grid rows overlapping full-sized thumbnails. Explicit content-sized rows fixed this; the final screenshot and geometry assertion pass.
- Built and installed `dist/Notebook-phone-0.14.1.apk` on `192.168.0.210:43907`; Android reports versionName `0.14.1`, versionCode `36`. APK SHA-256: `55141270561DD24531A2F01C11D1B3B1B770B01A94D479067BEA508AAF81052E`.
- No subjective smoothness or physical-phone interaction acceptance is claimed from emulator checks. The unrelated stale recognition report script remains documented above.

## Claude's handoff

# Notebook handoff for Codex (26 Sept 2026)

The only required work left is to finish the phone consistency pass, verify it, then build and install phone 0.14.0. Everything else is shipped or optional. HEAD is `71327d6`. The only modified file is `AGENTS.md`, which is the owner's own edit; don't overwrite it.

## Already shipped and installed (no action needed)
- **Desktop 2.4.0** is on the PC. **Phone 0.13.0** (built from `642fb2b`) is on the Samsung.
- They contain:
  - Ideas loading the next pins before you reach the end, on PC and phone;
  - the board-switch merge fix;
  - the error log (`main/errlog.js`, `ErrorLog.java`, `POST /api/log`).
- All checks passed for that release:
  - `test-library`;
  - `test-sync` (20);
  - `test-ui` (32, and again against the packaged app);
  - `test-features` (13, and again against the packaged app);
  - all five phone tests;
  - emulator end-to-end runs.

## What the owner asked for
The owner sent a phone recording. They want the phone app's interactions and visuals made consistent, because it "feels like separate components stitched together".
- Fix the gallery → picture → Details & boards flow first, and verify it.
- Then apply the same conventions across the whole app: navigation, sheets, spacing, type, corner radii, controls, touch feedback and animation timing.
- Fix shared causes, not individual screens. Keep the dark look. No redesign and no new features.
- Test real interactions. Report what was reproduced, what was fixed, what was tested, and what is still unverified.

## Part A: the picture viewer (done in `e28c603`; only re-verify)

**Files**
- `phone/app/src/main/assets/www/viewer.js` (new): every gesture on an open photo or video, one spring for all movement.
- `item.js` (new): the open item's screen, split out of `app.js`.
- `media.js`: now only the video player; the old second full-screen viewer is gone.
- `motion.js`: the back button fades in after a short delay; `revealCard` scrolls the grid to the right card before the picture flies back; the old swipe-down code is removed.
- `app.js`: `swipeList`, `peekHTML`, `swapItem(id, carry)`, and the new Back order.
- `app.css`: `.dhead`, `.media-body`, `.media-actions`, `.peek`, `.sheet.moving`.
- `index.html`: loads `viewer.js` and `item.js`.

**Behaviour now**
- Swipe sideways to move between pictures from the grid you opened it from.
- Drag down and the picture flies back into its card.
- Drag up, or tap the title bar, for Details & boards:
  - the sheet uncovers from the top;
  - Move to Bin and Done are always fully visible;
  - Done closes the sheet.
- Pinch or double-tap zooms in place. Panning stops at the picture's edges.
- While Details is open, only the sheet responds to gestures. While zoomed in, the sheet and back button fade out of the way.
- Android Back works in steps: zoom out first, then close Details, then leave the picture.

**Verified**
- `scripts/test-phone-media.js` (rewritten to use real touch input) passes. It covers:
  - rapid flicks;
  - lifting one finger mid-pinch;
  - frame sampling to prove the picture never disappears;
  - the order in which the sheet reveals its contents;
  - the Back order.
- The other four phone tests pass.
- `test-output/emu-viewer.js` passed on the emulator (AVD `S25U`, device `emulator-5554`), driven by Android's own touch input. I checked the recording frame by frame: `test-output/emu/viewer.mp4`.
- **Not verified on the owner's real phone**, because it was locked.

## Part B: the app-wide pass (in progress; `71327d6` is untested and incomplete)

**What `71327d6` contains**
- In `app.js`:
  - a `#popscrim` backdrop (`data-a="closePops"`) and a `closePops()` function;
  - `showSheet()` now leaves from wherever the sheet was dragged to, and also handles the backdrop;
  - `updateChrome` shows the backdrop whenever Add, Cover or a form sheet is open;
  - Android Back from Bin, Search and Sync now does the same as the on-screen buttons (`A.binBack` / `A.home`);
  - `M.wirePops(...)` is called on `#addsheet`, `#coversheet` and `#formsheet`.
- In `motion.js`:
  - `wirePops`: drag a pop-up sheet down to dismiss it. It closes past 70 px or 0.5 px/ms, otherwise it springs back.
  - One easing for screen changes, `EASE = cubic-bezier(.22,1,.36,1)`, and one duration, `DUR = 440`.

**Missing, and it will look broken until added**
- `.popscrim` styles in `app.css`: absolute, `inset: 0`, `z-index` 7 (below the nav at 8 and the pop-up sheets at 9), with a dim background such as `rgba(0,0,0,.45)`.
- `touch-action: none` on `.popsheet`. Without it, scrolling swallows the drag. I confirmed it isn't there yet.

**Still required to meet the owner's request**
1. **Shared tokens in `app.css` `:root`, used everywhere:**
   - Easing `--ease` (the value above), and durations: fast 180 ms, normal 320 ms, screen 440 ms. Replace the scattered `.45s` / `.48s` / `.55s` transitions. Keep the springy bounce only on press feedback.
   - Corner radii: cards 20, sheets 28 (`.sheet` is 32 today), text fields 14, pills fully round.
   - Greys: `--text-2` `#C8C8C8` and `--text-3` `#9A9A9A`. Fold `#B5B5B5`, `#BDBDBD`, `#ADADAD` and `#D6D6D6` into those two.
   - Small monospace labels share one style (10–11 px, weight 500, letter spacing .14em): `.micro`, `.lbl`, `.ct`, `.dategroup`, `.ideas-more`, `.stackct`.
2. **Press feedback on every control.** One shared `:active` style (scale about .96) for the controls that don't have one yet: `.btn`, `.chip`, `.iconbtn`, `.seg button`, `.dhead`, `.linkbtn`, `.tile`.
3. **Tap targets.** `.sortpill` is 28 px tall. Give it a tap area of at least 44 px without changing how it looks.
4. **Side margins.** Make them 16 px on every screen. Home's top bar is 20/16 today and the tabs-and-sort row is 16/14.
5. **Matching corners.** The open picture uses radius 22 but cards use 20. Make both 20 so the fly-in and fly-out line up exactly.
6. **Sheets:**
   - Remove the note screen's `.handle`: that sheet can't be dragged, so the handle is decoration (against the project's rules).
   - Add a real grab handle to the photo/video sheet's title bar, because that sheet can be dragged.
   - Give every bottom sheet the same surface, radius, padding and entrance animation.
7. **Back.** Check that Android Back on every screen matches that screen's visible back control, including closing the sort menu.
8. **`AGENTS.md`.** Add `viewer.js` and `item.js` to the phone file list, and note that swipe-down now lives in `viewer.js`. Merge carefully with the owner's uncommitted edit.

**Acceptance (the owner's words turned into checks)**
- Gestures follow the finger, settle or cancel cleanly, and cope with rapid or interrupted input.
- Back is predictable in every state.
- The gallery keeps its scroll position.
- No bottom actions are hidden or overlapping.
- One system for timing, corners, greys and touch feedback.
- No redesign and no new features.

## Verification (required before release)
**Ground rules**
- Run `node` directly; the folder path contains `&`, which breaks `npm run`.
- Test windows open on the second monitor.
- Run heavy jobs at Idle priority.

**Steps**
1. **Phone screen tests** (Edge, mock bridge): the five `scripts/test-phone-*.js` checks. Extend `test-phone-gestures.js` to cover:
   - tapping the backdrop closes the Add, Cover and form sheets;
   - dragging a pop-up sheet follows the finger, closes past the threshold, and springs back otherwise;
   - Back from Bin goes to Sync, and Back from Search or Sync goes to Home.
2. **Emulator.**
   - Start it with:
     ```bash
     "%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" -avd S25U -no-window -no-audio -no-snapshot-save -no-boot-anim -gpu swiftshader_indirect
     ```
   - Rerun `test-output/emu-viewer.js`, adding a sheet drag and a backdrop tap using `adb input`.
   - Check the recording frames with ffmpeg.
3. **Desktop.** No desktop checks are needed unless shared desktop files change (they shouldn't).

## Release (already authorised by the owner: "do it all and install")
1. In `phone/app/build.gradle.kts`, set `versionCode = 35` and `versionName = "0.14.0"`. Use sed-style edits: PowerShell's `Set-Content -Encoding utf8` adds a byte-order mark that breaks the file.
2. **Build.**
   - Copy `phone/` to `C:/Users/abdul/AppData/Local/Temp/nbphone-build`, leaving out `app/build` and `.gradle`.
   - Set `JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"`.
   - Run:
     ```bash
     java -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain assembleDebug
     ```
3. **Install.**
   ```bash
   adb -s 192.168.0.210:41265 install -r app/build/outputs/apk/debug/app-debug.apk
   ```
   - Always pass `-s`: the other connected device, `BYZL25052900310864` (cm01_se), is **not** the owner's phone.
   - The wireless port changes. If the install fails, ask the owner for the current one.
4. **Desktop.** No rebuild; 2.4.0 stays.
5. **Commit.**
   - Only the files you changed, never `git add -A`.
   - Author `-c user.name="Abdul" -c user.email="abdulmani762@gmail.com"`, with no AI attribution lines.
   - Plain-English message ending in "phone 0.14.0".

## Boundaries to keep
- Don't touch `D:\Notebook Library` except through the app.
- Don't touch the Notebook Promo folder; another agent owns it.
- No system or firewall changes, and never enter credentials.
- Don't change Pinterest account settings without the owner's OK.
- Installing on the owner's phone is authorised. Don't operate anything else on it; real-phone testing only works while it's unlocked.
- Run `node --check` on any Electron probe script before running it. A script that throws pops up an error dialog on the owner's screen.

## Optional (offered to the owner, not approved)
- Move `D:\Notebook Tools\models` from the USB hard drive to the B: SSD to shorten Ideas' cold start. This changes paths, so it's the owner's call.
- Further phone work: the board wheel on Home, the lift panel, and the item details drawer.
- Re-rate the matching sets (they scored 4/10) on the owner's own library.
- Confirm the viewer and the board switch on the real phone once it's available.

I couldn't save this as a file because this session is read-only (writing and shell were disabled), so this message is the handoff. I also didn't check `git log` or `git status` myself; the repo state above is as stated in your request.
