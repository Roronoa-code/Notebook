# Notebook interface continuity — active work

Owner request: all Notebook interactions should feel like one app, including custom file/folder pickers, confirmations and menus. Preserve dark mood-board design, offline architecture, data and original files. Only test changed/new flows, not old unrelated suites. Windows screenshots define the current scope; phone code is not being redesigned.

Already delivered during this session: Windows 2.5.3 installed and package hash verified, normal window reopened. Suggested uses one non-bouncy 240 ms unfold. Update/Check morph by crossfading their existing 18 px icon into the orb and back; no doubled icons. Relevant tests passed against packaged 2.5.3 (`test-output/suggest-motion-34432`).

Before this broader pass, full main/renderer source + manifests saved to the chat visualisation folder `interface-motion-baseline/source.zip`. Earlier unrelated `.gitignore`, `AGENTS.md` and `promo/` work must remain intact.

## Scope and acceptance

| Area | Work | Evidence required |
| --- | --- | --- |
| Confirmations | Custom modal for board deletion/Empty Bin; remove double-click warning; preserve main-process confirmation authority and cancellation | Cancel never mutates data or shows success; confirm removes only intended data; keyboard/focus/close/reload |
| File/folder picking | Custom in-app local browser for photos/videos/library/backup/restore/export destinations; navigation, multi-select, path entry, create folder | Temp filesystem tests: filtering, selection, cancellation, invalid paths, traversal validation, imports copy originals |
| Menus/panels | Shared restrained enter/exit, anchored origins, uninterrupted rapid reversal; fix instant Library/Links/Styles/Phone closure | Real-window targeted interaction checks, Escape/outside click and focus restoration |
| Board/header controls | Preserve header while renaming; stable toggle feedback; coherent press/focus and movement | Rename Enter/Escape/blur; toggle rollback on failure; header control positions |
| Remaining native menus | Audit Pinterest context menu and tray menu; avoid native-looking menu surfaces in app | Preserve available actions and validation |
| Delivery | Windows 2.5.4 target, normal install with data preserved | Build, focused packaged checks, installed hash/version |

## Findings

- Native UI: `main/main.js` `pickFolder` (showOpenDialog), `confirm` (showMessageBox), `items:pick` (showOpenDialog); `main/pinterest.js` pin context `Menu.popup`; `main/main.js` tray context menu.
- Board delete uses both "Click again to delete" in `renderer/app.js` and a native confirmation in main. Cancel result is truthy and currently can produce an incorrect deletion toast.
- `renderContext` wipes the entire heading/actions when renaming. On-phone update uses `NB.run`, which recreates the header and toggle immediately, cutting off its CSS motion.
- `renderer/util.js` menu/dropdown have independent enter/exit timings and can leave closing copies when reopened. `renderer/app.js` Library uses immediate hidden toggles; Links/Styles remove immediately; Phone close removes immediately. Shortcuts already have paired but separate timing.
- Existing desktop motion includes many spring curves and staggered effects. Unify routine controls/overlays with short non-overshooting easing, preserve meaningful card/viewer continuity rather than rebuilding it.

## Implementation direction (not yet implemented)

- `main/ui.js`: queued UI request bridge bound to current main webContents and request ID. Own confirmations and picker authorization; browsing/new-folder/selection validation only while the corresponding picker request is active. Cancel on owner destruction/reload. Never grant raw file writes beyond explicit new-folder action.
- `renderer/motion.js`: small shared interruptible surface show/hide/remove helper using existing Web Animations approach and reduced motion. Custom modal shell with real HTML dialog semantics/focus, response bridge.
- `renderer/picker.js`: custom dark file/folder picker using the same modal shell and bridge; actual native filesystem APIs stay in main.
- Main handlers retain current return contracts so saving/import/backup routines stay unchanged.
- Targeted new test script exercises these actual app workflows with temporary library/files. No real original files, real mouse or keyboard takeover.

## Implemented (2.5.4)

- Added request-bound custom confirmation/file picker bridge (`main/ui.js`), queued main-window requests with cancellation on reload/crash/close. Filesystem selection, file extensions, sender/request identity and new-folder names are validated in main. Existing import/backup/restore/export data contracts stay intact.
- Shared interruptible 200 ms entrance / 140 ms exit in `renderer/motion.js`, anchored to the opener where available, reduced-motion support, custom tooltips and sheet focus handling. Modal requests use a styled HTML dialog and serialize two-stage flows.
- Library, Links, Styles, dropdowns/action menus, Phone, Shortcuts, viewer, Ideas preview, Pinterest shell and selection bar use shared motion. Saved/Ideas retains its segmented control for a sliding indicator. Routine hover/press/switch/sidebar movement uses restrained easing.
- Rename keeps the header and actions in place. Phone toggles preserve their control while saving and roll back on error. Board deletion uses one custom confirmation; cancellation no longer redraws or claims success.
- Pinterest Save context menu is isolated in the panel preload, with main-bound pin selection. Tray right-click opens Notebook's Library surface with Quit Notebook. Removed the Windows tray balloon. Explicit Show in File Explorer remains an external utility action; Windows window chrome and third-party Pinterest pages are not restyled.
- No new dependency, data schema, original-file mutation, network capability, phone redesign or unrelated test suite.

## Verification / delivery state

- New `node scripts/test-interface-motion.js` passes from source (`test-output/interface-motion-32728` before final hidden-surface/focus guard). It covers owner validation, extensions, folder names, reload cancellation including queued requests, modal Escape/focus, board delete cancel/confirm, rename Enter/Escape, stable switch + rollback, real imports preserving originals, folder creation/cancellation, backup folder choice and both Restore stages, dropdown/Styles/selection menus, Saved/Ideas DOM continuity, rapid reversal, reduced motion, nested Phone picker, viewer reversal, tray surface, 900 px layout, Pinterest context menu with an offline stand-in, and Empty Bin cancel/confirm. No old unrelated suites run.
- Inspected finished-frame confirmation and file picker screenshots. Behaviour checks sample real reversal continuity; still screenshots alone do not establish the owner's motion preference.
- Version bumped to 2.5.4. Installer build running; packaged verification and normal installation still pending.

## Delivered

- Clean Windows 2.5.4 build completed. A last accessibility edit during the first packaging attempt invalidated that attempt; it was discarded and rebuilt from frozen source before testing or installing.
- Packaged `test-interface-motion.js` passed (`test-output/interface-motion-40592`), including byte-for-byte comparison of every packaged main/renderer file with source. Only the new targeted check ran.
- Silent normal installer exited 0. Installed version is 2.5.4.0. Installed `resources/app.asar` matches the checked build: SHA-256 `74E5824C4FB41D163377EBBD9202307192BF60D442792AE86B41FE98C302702F`.
- Pre-install config/library metadata copies are under the chat visualisation folder `interface-motion-baseline/preinstall-2.5.4`. Owner library SHA-256 stayed `1506D06A93C1A04993FD22D9BCCC363B0DF9FD221308A33B4AEB7CF6224BC202` through installation.
- Restored the owner's prior background state (normal installed package, `--background`). Main process running, sync listening on 47821, no new errors in the normal desktop log. Existing older phone log errors were not expanded into this desktop task.
- Physical motion preference still belongs to the owner; no claim of their acceptance. Pinterest context-menu verification used an offline local document, not a live account. No Android update was needed for this desktop-only pass.
