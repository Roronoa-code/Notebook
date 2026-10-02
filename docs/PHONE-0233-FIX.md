# Notebook phone 0.23.3 — 2 October 2026

Installed versionCode 81 / versionName 0.23.3 on the owner's SM-S938B using the existing com.mani.notebook package.
Library SHA-256 matched before and after installation.

## Cause and fix

- Notes had a one-column CSS layout but received the photo grid's two-column ordering and forced column break. The second column overflowed into the neighbouring For you pane. Notes now retain their sorted, single-column markup.
- The pager suppressed the first touch movement, then accelerated to catch up. It now follows the first movement directly.
- Catching a moving tab removed the outgoing pane until the next movement. Both panes now remain present at the same positions.
- Every card made a synchronous Android call to read the same pinned-item preference. 120 reads took 17.8 ms on the phone. This preference is now read once and updated when pinning changes.

## Verification

- New multi-note regression failed before the layout correction and passed afterwards.
- New regression passed on installed 0.23.3, including multiple notes, first movement, interrupted swipes, rapid reversal and note boundaries during movement.
- Physical-phone mid-swipe inspection: Notes occupied x=-192..192; For you occupied x=192..576; no notes in For you and no notes outside their own pane.
- Phone navigation, swipe, recording audit, continuity and library suites passed after the final layout correction.
- Phone media, gestures, ideas, audit and Java PhoneTaste checks passed during this task; their unaffected flows were not rerun unnecessarily.
- Library (32), sync (20), ad filter, Gallery protocol/UI, features (14), source desktop UI (32) and packaged desktop UI (32) passed.
- Recognition: types 36/40, colours 17/20, styles 17/20 passed. Suggestions evaluation completed (5 groups, 3 sets; subjective rating not claimed).
- Download links: 20/20 passed. Desktop screenshot audit completed with no page errors.
- Android APK and Windows NSIS builds completed. Only the Android app was updated on the user's device.
- Syntax and git diff whitespace checks passed.

## Separate desktop failures in unchanged code

- scripts/test-pc-motion.js: assertion at line 44, “the binned card is drawn leaving for several frames”; reproduced twice.
- scripts/test-pinterest.js: timed out waiting for the first .bcard at line 33 during test setup.

These desktop failures remain unresolved; they do not exercise the modified phone files.
