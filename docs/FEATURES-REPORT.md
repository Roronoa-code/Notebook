# Full version: results against the build plan

Tested on 23 September 2026 (Notebook 1.4.0, RTX 5080). Each item is marked **passed**, **failed**, **inconclusive** or **not checked**, with the plan's own pass marks.

## Step 0: inspect and back up
- **Passed.** Code backed up as a git bundle and library backed up with the app's verified backup, both in `D:\Notebook Backups`. Both were restored into a separate folder: the code matched exactly; the library had all 9 items, 7 boards and 12 files, byte for byte.

## Track A (runs on your PC)
Test images: 40 free-licence pictures from Wikimedia Commons (20 outfits including busy street backgrounds, groups and clothes on hangers; 6 wallpapers, 5 icons, 5 profile pictures, 4 others), each labelled by eye. `node scripts/test-recognition.js`.

| Item | Result | Pass mark |
|---|---|---|
| A1 item types (main + extra labels) | **Passed: 36/40** | 34+ (fail under 30) |
| A2 clothing colours (from the clothes only) | **Passed: 17/20** | 16+ (fail under 12) |
| A2 styles (your pick in the top two) | **Passed: 17/20** | 14+ (fail under 10) |
| Corrections survive a restart and a re-scan | **Passed** (`test-features.js`) | |
| Filters return the right items | **Passed** (`test-features.js`) | |
| A3 suggested outfit groups | **Passed: 8/10 make sense** | 7+ |
| A3 matching sets (wallpaper, icon, profile picture) | **Failed: 4/10 usable** on public test pictures | 6+ |
| Nothing leaves your PC | **Passed**: the whole 40-image run completed with every network function in Node blocked; zero attempts. The app page stays blocked from the web. | |
| Existing features still work | **Passed**: all existing checks (storage 25, sync 17, desktop 18, phone 4 suites) | |

Notes:
- A3 was rated by Claude (you asked for the tests to be run for you), on a pool of 224 public images. The outfit groups are look-alike clusters (coats, street style at fashion weeks, punk/goth, lolita, summer dresses, cosplay…). The matching sets fail mainly because the public pool has few real icons and avatars that suit each other (badges, logos, lab photos). With your own wallpapers, icons and avatars they should do better; worth re-rating on your library. Bad suggestions can be dismissed and never move anything.
- Style labels are subjective: the 17/20 is against styles picked by Claude.

## Track B (saving from links)
| Item | Result | Pass mark |
|---|---|---|
| B1 automatic saving from 20 mixed links | **Passed: 20/20 saved and playable offline** (7 TikTok videos, 5 photo slideshows, 5 Pinterest image pins, 3 video pins) | 18+, a clear message for every failure |
| Failures: plain message + retry list | **Passed** (removed post, wrong link, not TikTok/Pinterest) | |
| "Check my links" and "Update downloader" | **Passed** (only runs when pressed) | |
| B2 Pinterest panel, 10 chosen pins | **Passed: 10/10 saved once each; nothing saved while browsing** | all 10, nothing extra |

This shows saving works today, not that it will keep working: TikTok or Pinterest can change their sites. The downloader is one file (`main/downloader.js`) plus two replaceable tools in `D:\Notebook Tools\bin`.

## Packaging
- **Passed**: the 1.4.0 installer's app recognises pictures with the real models on the graphics card (`test-packaged-recognition.js`), and the desktop, feature and Pinterest checks pass against the packaged app.
