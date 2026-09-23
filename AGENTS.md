# Notebook: notes for coding agents

Offline Electron app for Windows. The owner is a beginner, so explain in plain UK English.

## Layout
- `main/library.js` handles all saving: library.json (atomic write + `.bak`), imports (copy + size check), notes, boards, Bin, backup/restore (verified copies into new folders), export. Plain Node with no Electron.
- `main/merge.js` is the phone sync merge (the rules in `docs/SYNC.md`) and the check of what the phone sends. Pure functions.
- `main/sync-server.js` is the phone sync server: plain Node `http` (TCP 47821, next ports if busy) and `dgram` (UDP 47822 discovery), pairing codes, bearer tokens (only SHA-256 stored). Paired phones, `pcId` and `keepReady` live in `sync.json` in the app's userData, never in the library.
- `main/main.js` is the window, the `nb://notebook/` protocol (`/app/` = renderer, `/lib/` = current library, with range support for video seeking), IPC handlers, dialogs, the network block (the page itself can't reach the web), the sync server's lifecycle, the tray, `--background` start and the single-instance lock.
- `main/preload.js` is the only bridge (`window.nb`).
- `renderer/`: `app.js` (sidebar with add, search, boards, Bin, Phone and Library menu; the mood board grid, thumbnails, drag-drop, refresh after a phone sync), `stacks.js` (fanned stacks and Ctrl-click picking: stack, hide from phone, Bin), `viewer.js` (open item, note editor, Tidy up, Show on phone switch), `phone.js` (the Phone panel), `util.js`, `styles.css`. Classic scripts, no build step. Fonts are bundled. Two tones: grainy background, one flat surface colour for panels.
- `phone/app/src/main/assets/www/`: the phone screens. `app.js` (state, screens, actions), `motion.js` (screen changes, the photo overlay, items panel spring, swipe-down, stacks and drag-to-stack), `wheel.js` (board wheel), `media.js`, `text.js`, `mock.js` (stand-in for the Android side when testing on the PC).

## Rules
- Must work fully offline. No web requests, no cloud, no paid APIs, no Supabase. The only network use is phone sync on the home network (private addresses only), as set out in `docs/SYNC.md`. That file is the contract with the phone app: don't change behaviour without changing both.
- Never modify or delete the user's original files. Imports copy into the library.
- Dark mode only. Liquid glass, fun motion, but every element needs a purpose (no decorative dots or gradients).
- Don't change data shape in library.json without a migration. It's version 2 now (board `updatedAt`, `tombstones`), migrated from v1 on load. Changes that should sync must bump the item's `updatedAt`.

## Checks (run all before delivering)
The folder path contains `&`, which breaks `npm run`, so call node directly:
- `node scripts/test-library.js`: saving, boards, Bin, backup/restore, export, recovery, v1 to v2 migration and the sync merge rules.
- `node scripts/test-sync.js`: starts the real sync server on 127.0.0.1 against a temporary library and acts as the phone (pairing, sync, media up/down, discovery, address check).
- `node scripts/test-ui.js`: drives the real window (needs ffmpeg for sample media), including the Phone panel, hide-to-tray and `--background`. It sets `NOTEBOOK_USER_DATA`, `NOTEBOOK_SYNC_HOST=127.0.0.1` and `NOTEBOOK_SYNC_PORT` so it never uses your settings, never triggers Windows Firewall, and never registers Notebook to start with Windows.
- Phone screens (need Microsoft Edge; use the mock bridge in `phone/.../www/mock.js`, never the phone): `node scripts/test-phone-nav.js`, `node scripts/test-phone-media.js`, `node scripts/test-phone-library.js` (search, Bin, mood-board cards), `node scripts/test-phone-gestures.js` (panel drag and flick, swipe down to close).
- Build the installer: `node node_modules/electron-builder/cli.js --win nsis`. Then run the UI check against it with `NOTEBOOK_EXE="…\dist\win-unpacked\Notebook.exe"`.
