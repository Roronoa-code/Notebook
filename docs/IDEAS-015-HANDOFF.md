# Independent Ideas, 26 September 2026

Baseline: 690d2a1. The owner's existing AGENTS.md edit is preserved.

The owner approved repairing Pinterest discovery and explicitly requested fresh Ideas on the phone while the PC is off or away from home. Library sync stays on the private home network. No account cookies, private library pictures or models are uploaded.

Acceptance ledger:

- [x] PC feed continues beyond 300 pins, ranks recent saves, survives partial failures and delayed AI results.
- [x] Explicit refresh fetches new results; automatic background fetching remains bounded.
- [x] Search and More like this work in Notebook on PC and phone, with visible Back and retained context.
- [x] Phone fetches public Pinterest results, pictures and saved media directly; works without pairing.
- [x] Cached ideas remain available offline; failed saves never show Saved.
- [x] Regression tests, public source smoke check, native build and isolated Android journey.
- [x] Updated phone APK and Windows installer, with delivery status recorded accurately.

## Behaviour

- PC Ideas combines the signed-in Pinterest home feed when available, related pins and searches derived from saves/boards. Local image fingerprints rank against the most recent 400 eligible saves. Explicit searches keep their requested topic. Hidden feedback persists across restarts, and delayed AI checks cannot contaminate a refreshed feed.
- PC feeds become stale after three hours; the existing hourly background check refreshes eligible ordinary feeds. Phone feeds become stale after 30 minutes and refresh when requested by the Ideas screen. New ideas forces a refresh on both. Neither setting means continuous phone background polling.
- Pagination keeps the full browsing session. The newest 300 pins per persisted feed remain on disk with advanced bookmarks, so 300 no longer ends scrolling. Desktop search/related contexts are session-only.
- Phone Ideas uses native HTTPS for public Pinterest search/related results, using recent saves and text matching. It does not inherit desktop account recommendations, CLIP ranking or the PC's AI-image detectors. Promoted results are filtered. The phone WebView itself remains blocked from the web.
- Phone saves download original images or supported direct videos into the existing library; ordinary LAN sync transfers them later. URL/redirect allowlists, response limits, content validation and readable-media checks reject bad downloads before import. Unsupported video streams fail visibly instead of saving a poster as a video.
- Search and More like this have visible Back controls and retain the preceding context. Results expand Home's content panel. Preview sheets have Done, and asynchronous updates preserve a focused search field. Save shows Saved only after native completion.

## Verification, current change

- `node scripts/test-library.js`: 32 passed.
- `node scripts/test-sync.js`: 20 passed.
- `node scripts/test-feed.js`: passed, including pagination beyond 300, recency, partial failures, refresh, empty filtered feeds, hidden feedback and deferred AI races.
- `node scripts/test-adfilter.js`: passed.
- All five Edge/mock phone suites passed: nav, media, library, gestures and ideas. Ideas was rerun after the final UI edit; covers unpaired search, related results, nested Back, forced refresh, save failure/retry, focus and narrow layout.
- `node scripts/test-ui.js`: 32 passed from source and again against the packaged Windows executable.
- `node scripts/test-features.js`: 14 passed from source and again against the packaged Windows executable. Per-process output directories prevent concurrent test cleanup collisions.
- `node scripts/test-pinterest.js`: 9 passed against real public Pinterest, including real feed pictures and saving. Additional anonymous search/related smoke checks passed.
- `node scripts/audit-app.js`: no page errors. Final packaged screenshot inspected at `test-output/features-50644/ideas.png`.
- Android debug build succeeded. Final changed runtime inputs match the staging directory used for that APK.
- `$env:NOTEBOOK_TEST_EMULATOR='emulator-5554'; ./scripts/test-phone-ideas-native.ps1`: passed on real Android runtime. Checks Android JSON null handling, parsing, ads, approved URLs, pagination state, direct MP4 preference, MIME validation and rejection of truncated/magic-only media.
- With the same emulator selected, `node scripts/test-phone-discovery.js`: passed unpaired public search, real pictures, related pins, Back, original-image save, durable saved state and cached images after restarting in airplane mode. The test restores the emulator's radio state. Its restart connection was corrected to attach to the new WebView process; this was a test harness issue, not an app crash.
- Final native search screenshot inspected at `test-output/phone-discovery/native-search.png`.
- No live Pinterest video download was exercised in this run; video parsing and invalid-video rejection were checked. Recognition accuracy, suggestion rating and the 20-link downloader suite were not rerun: those models and implementations are unchanged. The older recognition test's stale `nameFrom` import remains documented in `PHONE-014-HANDOFF.md`.

## Delivery

- Phone **0.15.0 (38)** installed successfully on the authorised `192.168.0.210:43907`; package version read back. Existing app data retained. Interaction checks were on the emulator, not the physical phone.
- APK: `dist/Notebook-phone-0.15.0.apk`.
  SHA-256: `2F28115DE4EB7186B48FC508A42A1AE1FB696E1251D32ACC8E786DB43CF464BC`.
- Windows **2.5.0** installer built and packaged checks passed: `dist/Notebook Setup 2.5.0.exe`.
  SHA-256: `66D3410E9D944ECC002E014743103F039BC1DFCA65416789ACA2B93D435ADC91`.
- The Windows update has **not been installed over the owner's running app**. No forced quit, user-library edits, account-cookie transfer or remote push was performed.
- Public Pinterest endpoints can change or rate-limit requests. Errors retain cached results and offer retry; independent phone discovery is not the same personalised feed as the signed-in Pinterest app.
