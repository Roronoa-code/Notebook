# Phone Gallery cleanup

## Scope

The desktop sidebar combines a virtual thumbnail grid with one-item review, local keep/trash decisions, multi-selection, explicit trash batches and recent batch restore. It uses Android MediaStore on Android 11+; Android 13+ granular and Android 14+ selected-photo permissions are recognised. It lists shared on-device media visible to the permission grant. Cloud-only photos, Samsung Private Album/Secure Folder and ungranted media are outside this view.

The user starts an explicit foreground session in the existing phone app. Keep the app open and phone unlocked; leaving it stops the session except while its one system consent dialog is pending. No background service or background activity launch bypass is installed. Optional Android media-management access can reduce prompts; broad photo/video access is still required.

## Safety and limits

- K/T/Delete affect only PC decisions. Trash marked asks before sending a batch. Android createTrashRequest handles both trash and restore; no permanent-delete fallback exists. Android/Samsung controls retention. Emptying the phone recycle bin makes restore unavailable.
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
