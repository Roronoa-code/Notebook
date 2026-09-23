# Notebook: notes for coding agents

Offline Electron app for Windows. The owner is a beginner, so explain in plain UK English.

## Layout
- `main/library.js` handles all saving: library.json (atomic write + `.bak`), imports (copy + size check), notes, boards, Bin, backup/restore (verified copies into new folders), export. Plain Node with no Electron.
- `main/main.js` is the window, the `nb://notebook/` protocol (`/app/` = renderer, `/lib/` = current library, with range support for video seeking), IPC handlers, dialogs and the network block.
- `main/preload.js` is the only bridge (`window.nb`).
- `renderer/`: `app.js` (board cards, grid, dock, thumbnails, drag-drop), `viewer.js` (open item, note editor, Tidy up), `util.js`, `styles.css`. Classic scripts, no build step. Fonts are bundled.

## Rules
- Must work fully offline. No web requests, no cloud, no paid APIs, no Supabase.
- Never modify or delete the user's original files. Imports copy into the library.
- Dark mode only. Liquid glass, fun motion, but every element needs a purpose (no decorative dots or gradients).
- Don't change data shape in library.json without a migration.

## Checks (run all before delivering)
The folder path contains `&`, which breaks `npm run`, so call node directly:
- `node scripts/test-library.js`: saving, boards, Bin, backup/restore, export, recovery.
- `node scripts/test-ui.js`: drives the real window (needs ffmpeg for sample media).
- Build the installer: `node node_modules/electron-builder/cli.js --win nsis`. Then run the UI check against it with `NOTEBOOK_EXE="…\dist\win-unpacked\Notebook.exe"`.
