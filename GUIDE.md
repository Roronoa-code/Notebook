# Notebook: plain-English guide

An offline, Pinterest-style notebook for Windows. Photos, videos and notes live on
boards, everything stays on your PC, and nothing is uploaded.

## Installing

1. Double-click `dist\Notebook Setup 1.0.0.exe`.
2. Windows may show **"Windows protected your PC"**. This appears because the app isn't
   signed with a paid certificate, not because anything is wrong. Click **More info → Run anyway**.
3. Pick where to install (the default is fine). You'll get Start menu and desktop shortcuts.
4. The first time Notebook opens, choose **Use D:\Notebook Library** (or another folder).

## Where your things are

| What | Where |
|---|---|
| Your library | `D:\Notebook Library` (or the folder you picked) |
| `library.json` | The list of every item, note and board |
| `library.json.bak` | The previous save, used automatically if `library.json` is ever damaged |
| `media\` | Full copies of your photos and videos. Your originals are never touched. |
| `thumbs\` | Small previews. Safe to delete: Notebook remakes them. |

The folder button (top right) shows the library's location and can open a different library.

## Everyday use

- **Add**: use the dock at the bottom, or drag files onto the window. If a board is
  open, new things land on that board.
- **Boards**: click a board card to switch. Use **New board**, then **Rename board** or
  **Delete board**. Deleting a board never deletes its items.
- **Open anything**: click it. Photos open full size (click to zoom), videos play inside
  the app, and notes open in the editor. Use ← → to move between items and Esc to close.
- **Several boards**: tick boards on the right when an item is open.
- **Notes**: bold, italic, bullet lists, headings. **Tidy up** turns messy text into a
  heading and bullet points (no AI, all on your PC). **Undo tidy** puts it back.
- **Bin**: **Move to Bin** keeps the item with its boards. Restore it from the Bin.
  **Empty Bin** deletes permanently and asks first.
- **Search**: Ctrl+F. **New note**: Ctrl+N.

## Keeping it safe

- **Back up**: copies the whole library into a new dated folder and checks every file.
  Back up to a separate drive now and then (your B: drive if it's a separate physical
  drive, plus an occasional external drive).
- **Restore**: pick a backup folder, then where to put the restored copy. Your current
  library is left alone, and Notebook switches to the restored copy. To go back, use the
  folder button → **Open another library**.
- **Export**: makes a folder anyone can open without Notebook: `Media` (every photo and
  video, named by title), `Notes` (each note as a .txt file) and `boards.csv` (which
  boards each item is on; opens in Excel).

## Video formats

Samsung MP4s (camera, downloads and screen recordings) play inside the app. If a
video ever says it can't play, it's still stored safely: use **Show file in folder**
to open it in another player.

## For future coding sessions

See `AGENTS.md` for how the code is laid out and how to check changes.
