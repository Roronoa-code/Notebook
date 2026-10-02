# Phone Gallery cleanup

## Scope

The desktop sidebar combines a virtual thumbnail grid with one-item review, local keep/trash decisions, multi-selection, explicit trash batches and recent batch restore. It uses Android MediaStore on Android 11+; Android 13+ granular and Android 14+ selected-photo permissions are recognised. It lists shared on-device media visible to the permission grant. Cloud-only photos, Samsung Private Album/Secure Folder and ungranted media are outside this view.

The user starts the session once in the phone app. It then runs in a foreground service (GalleryService, type dataSync) with an ongoing notification and a Stop action, so Notebook can be left and the phone locked; it ends when stopped, after 30 minutes without PC requests, or at Android's foreground-service time limit. Reads (listing, thumbnails, previews, videos) work in the background. A batch always goes through Android's createTrashRequest/createWriteRequest (a direct IS_TRASHED update of another app's photo is refused even with media-management access, which only skips the dialog). It needs Android's consent from Notebook's own screen: if the app is not open, a high-priority notification asks, and tapping it opens Notebook, which launches createTrashRequest (no dialog when media-management access is granted). The PC waits up to 10 minutes for that; later results are recovered with Check on phone. No background activity launch bypass is used. Optional Android media-management access can reduce prompts; broad photo/video access is still required.

## Safety and limits

- K/T/Delete affect only PC decisions. A finished batch is announced on both devices (PC toast with Undo for trash; phone notification). Trash marked asks before sending a batch. Android createTrashRequest handles both trash and restore; no permanent-delete fallback exists. Android/Samsung controls retention. Emptying the phone recycle bin makes restore unavailable.
- Batch journals survive app restarts on both ends. Unknown results require Check on phone, never automatic replay. Check also recognises files removed outside Notebook.
- Native thumbnails use loadThumbnail; larger images are decoded to at most 2048 pixels. Two media workers and viewport-only thumbnail requests keep memory/DOM bounded. Metadata pages hold 256 items.
- Only an explicitly opened video is transferred, up to 256 MB, then played locally with seeking. Larger or unsupported formats offer Play on phone. This first version does not remotely stream arbitrary large files.
- Temporary PC media cache is capped at 384 MB and cleared when access/session ends or the app restarts. The local operation journal and review decisions persist. No cloud copies or full-library mirror.
- Refresh checks external Gallery changes. Reconnect reloads metadata. Every mutation independently checks identity/state even if the grid is stale.

## Verification, 28 September 2026

Physical device: Samsung SM-S938B, Android 17/API 37, Samsung Gallery 15.9.00.50. Used two generated disposable samples owned by com.android.shell, not Notebook-owned media.

Verified secure pairing; listing; thumbnail, large preview and MP4 transfer; real Android batch denial leaving both files unchanged; real Android batch approval returning both IS_TRASHED states; both samples visible in Samsung Gallery's recycle bin; Notebook restore through Android confirmation; restored photo and video SHA-256 hashes matching their original files. The user emptied the recycle bin during an earlier run; the app now correctly reconciles those finished items as unavailable. No personal media was selected by the tests.

Automated: scripts/test-gallery.js exercises actual HTTPS transport, pin mismatch, downgrade rejection, device/session isolation, batch validation, durable results, restore identities and disconnect without replay. scripts/test-gallery-ui.js drives the real Electron window with a synthetic phone, covering bounded grid, keyboard review, local undo, multi-select, cancel/commit and disconnect.

Not physically verified: selected-only permissions, optional MANAGE_MEDIA prompt suppression, other Samsung/Android versions, removals of external storage, every media codec. Core workflow was tested with normal Android confirmation prompts enabled.

The installed Windows 2.6.0 app was then securely re-paired to the normal phone app. Verified real thumbnail rendering, large photo preview, MP4 playback and seeking, UI multi-select → Trash marked → Android consent → Recent trash → Restore, and foreground stop/reconnect. Both restored files matched their original SHA-256 hashes again. Existing library/phone data were preserved; the two generated samples remain in Pictures/NotebookCleanupTest.

Desktop regression checks: all 32 test-ui.js checks and the full test-interface-motion.js suite passed after updating their old picker/confirmation assumptions and animation waits. Gallery UI checks passed against both source and packaged Electron; packaged main/renderer files were compared byte-for-byte with source. Core library (32), legacy sync (20), phone navigation/media/library/gestures/ideas, and the ad-filter checks also passed.

The 14 offline feature checks (stand-in recognition, corrections, styles, suggestions and Ideas) also passed; their setup and selectors were updated for the existing in-app picker and reversible motion.

## Google Photos copies
With Samsung Gallery's cloud sync on, a photo moved to the phone's trash still shows in Gallery as its Google Photos copy. Connect Google Photos (Gallery → Google Photos) once: it opens Chrome/Edge with a profile of its own for sign-in. After each trash batch the PC asks the phone for the trashed files' SHA-1s (`hash` command, reads files in place) and moves the Google Photos copies with those SHA-1s to Google Photos' trash; the matches are kept with the batch (`cloud.keys`), and a finished restore of that batch restores them (`cloudRestore`). Older batches: Recent trash → Remove Google Photos copies.
