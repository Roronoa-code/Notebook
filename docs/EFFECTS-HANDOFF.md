# Loading effects — 27 September 2026

## Suggested and working icons — Windows 2.5.3

Owner chose a short smooth Suggested unfold with no bounce. The section height and chevron now share a 240 ms non-overshooting ease; removed row translation, fading and stagger. Existing inert state, keyboard control and remembered open/closed state remain.

Update downloader and Check my links now mount the working orb in the existing 18 px icon slot, blending the original icon into it over 180 ms and back on completion/error. There is one indicator, with no extra orb pushing the label aside. The original two-second loading threshold and reduced-motion behaviour remain. This is a visual crossfade/scale transition, not a geometric SVG-to-particle morph. No shared phone assets changed.

Only the new `scripts/test-suggest-motion.js` checks run for this change: real isolated app, supplied suggestions and stubbed maintenance responses, monotonic opening/closing, rapid reversal, keyboard, reduced motion, remembered state, single icon slot, unchanged label position during the swap and restoration on completion/error. Source pass evidence: `test-output/suggest-motion-23288/`. Existing unrelated suites are not rerun.

The same targeted check passed against packaged 2.5.3: `test-output/suggest-motion-34432/`. Screenshots and frame measurements support the implementation checks; the owner's judgement of how the motion feels remains subjective.

## TikTok feedback follow-up — Windows 2.5.2

The saving text was only written into the normally hidden Pinterest panel. The completion toast lasted 3.8 seconds even while away from Notebook, and its layer was below the Ideas preview. Link saves now immediately show an animated, persistent saving toast; the same URL's toast is replaced by a success tick and source-specific confirmation, duplicate notice, or error with a Links action. Success stays for six seconds of focused Notebook time. Toasts appear above previews. Phone source is unchanged by this follow-up.

The expanded `scripts/test-effects-desktop.js` pastes a TikTok URL through the real renderer and main save flow, with only downloader output stubbed into a temporary library. It checks immediate feedback, delayed beam, actual imported item, success tick, hidden-window retention, expiry after returning focus, duplicates, errors and overlay layering. It never downloads a real post or uses the owner's library. Only this new-scope check and the animation preview checks are run for this follow-up. The preview covers all 12 desktop/phone effect placements using the shipped drawing engine and CSS.

Passed against the packaged 2.5.2 build; screenshots: `test-output/effects-desktop-10464/saving-effect.png` and `tiktok-added.png`. The test disables Playwright focus emulation to check a genuinely hidden window, then enables it to check foreground expiry without moving the user's focus. Source/build checks do not contact TikTok; the downloader itself was unchanged.

Installed Windows 2.5.2 in the normal location: installer exit 0, installed version read back, package hash matches the checked build, library metadata unchanged. Restored the normal app in background mode. Android stays on 0.15.1; this follow-up does not change phone code.

Approved scope: reuse the side-by-side comparison's React-free Thinking Orbs and Border Beam in existing waits on desktop and phone. No React, network dependencies, data-format or navigation changes.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Matching visuals | MIT thinking-orbs 0.3.2 drawing engine; border-beam 1.4.1 line CSS, Ocean | Comparison verified all nine orb states, two sizes and eight beam combinations |
| Real work only | Ideas finding/pagination, saving links/ideas, picture search, phone connecting, downloader maintenance | New effects checks passed through actual phone callbacks and packaged Windows save IPC |
| Short waits stay quiet | Orb after 2 s, beam after 3 s, original job timestamp survives redraw | `node scripts/test-effects.js` passed, including stale search completion |
| Cleanup and accessibility | Pause offscreen/background, honour reduced motion, retain labels and focus | Reduced-motion, removed-host and completion/error checks passed; visibility logic reviewed |
| Desktop and phone delivery | 2.5.1 / 0.15.1 (39) | Both installed in place. Phone version read back and launch confirmed on Samsung `192.168.0.210:37367`. Windows installer exited 0; installed app passed the new effect check; app.asar hash matches build |

`renderer/effects.js` and `renderer/effects.css` are the canonical shared UI. Run `node scripts/sync-effects.js` after changes; the phone copies must match. The vendored orb engine is upstream generated code with its licence retained. Beam CSS is generated from the reviewed upstream source and scoped to the loading overlay, preserving the host control's layout and radius.

Baseline saved outside the repository in this chat's visualisation folder. Unrelated `.gitignore`, `AGENTS.md` and `promo/` changes are preserved.

New checks: `scripts/test-effects.js` (headless phone mock/shared controller) and `scripts/test-effects-desktop.js` (isolated real Windows window, accepts `NOTEBOOK_EXE`). No tests use the owner's library or real mouse/keyboard. Screenshots are in `test-output/effects-phone-ideas.png` and `test-output/effects-desktop-*/saving-effect.png`. Physical phone verification confirms installation/launch; detailed effect behaviour was checked with the mock, not phone automation.

Windows was restored to its previous background mode. Owner library metadata and configuration are byte-identical to the pre-install checkpoint. Installed artefacts: `dist/Notebook Setup 2.5.1.exe` and `dist/Notebook-phone-0.15.1.apk`. Final installed Windows effect screenshot: `test-output/effects-desktop-35844/saving-effect.png` (CSS fixed at 900 ms to allow a visible capture without focusing the quiet test window).

Pairing remains intact; only the existing device's `lastSyncAt` changed after the phone synced. The physical phone also reported the pre-existing generic `Cannot read properties of null (reading 'style')` screen error seen in earlier logs. This is outside the new effects checks and was not investigated or changed; installation/launch confirmation is not a claim that all physical-phone behaviour is error-free.

Before the owner's request to restrict checks, the existing library, sync, adfilter, feed, five phone suites, source UI (32), feature suite (14), audit and link downloads (20/20) completed successfully; suggestions evaluation completed. The old recognition check failed on its obsolete `nameFrom` import. Pinterest checks were stopped when the owner asked to run only new tests. From that point onward only the new effects checks were run; unrelated recognition code was not changed.

Windows 2.5.4 adds the cohesive custom-dialog/picker/motion pass requested after 2.5.3. Installed and checked; see `INTERFACE-MOTION-HANDOFF.md` for scope, targeted evidence and installed hash. Phone remains 0.15.1.
