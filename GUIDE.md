# Notebook: plain-English guide

A Pinterest-style notebook for Windows. Photos, videos and notes live on boards and
everything stays on your PC. Nothing you save is ever uploaded. The only things that use
the internet are the ones you ask for: saving from a TikTok or Pinterest link, and the
Pinterest panel. Recognising your pictures happens on your own PC, even with the internet off.

## Installing

1. Double-click the newest `dist\Notebook Setup <version>.exe`.
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

**Library** (bottom left) shows the library's location, can open a different library, and has Back up, Restore and Export.

## Everyday use

- **Add**: **Photos**, **Videos** or **Note** at the top left, or drag files or whole folders
  onto the window. **Ctrl+V** pastes a picture (a screenshot, or an image copied from a
  website), or a TikTok or Pinterest link (see below). You can also drag a picture straight out
  of your browser. If a board is open, new things land on it. The same picture is never added
  twice: you're told it's already there, with **Show it**.
- **Boards**: they're listed on the left; drag one up or down to move it (or Alt + ↑ / ↓). Use **New board**,
  then **Rename board** or **Delete board** (click it twice). Deleting a board never deletes its items.
- **Sort**: the menu next to the item count: **Newest added**, **Oldest added**, **Date taken**
  (newest or oldest first, split into months) or **Name**. Each board remembers its own. The
  date taken comes from the photo itself (what your phone or camera recorded), or from a dated
  file name like `20260306_210639.jpg`; things with neither (saved pins, screenshots) use the day
  you saved them. Your phone has the same menu (the small pill at the top of Home and of each board).
- **Card size**: Ctrl + mouse wheel over the board, or Ctrl + plus / minus (Ctrl + 0 goes back).
  Videos play quietly on their cards while the pointer rests on them.
- **Picking several**: Ctrl-click (or tick) cards, or Ctrl+A for everything showing. Then
  **Stack**, **Add to board**, **Hide from phone** or **Move to Bin** (or press Delete). Dragging
  one picked card brings the others with it.
- **Stacks**: drag a card onto another card to stack them (drag more on to add to it), or
  Ctrl-click (or tick) several and press **Stack**. A stack shows as one card that takes the
  shape of the picture on top; drag across it (or scroll sideways, or use the arrow keys) to go
  through it. Inside a board, only stacks you made in that board are grouped; everything else
  shows as separate cards there, and every stack is grouped in **All items**. Open one and
  choose **Take out of stack** to split it up. The pick bar can also **Hide from phone** or
  **Move to Bin**.
- **Crop**: open a photo or video and press the crop icon at the top, drag the frame (or its corners), then
  **Save crop**. Only the part you chose shows, here and on your phone. The original file
  stays whole: **Change crop** → **Show the whole picture** brings it all back.
- **Open anything**: click it. Photos open full size (click to zoom), and notes open in the
  editor. Camera RAW photos (`.dng`, from a phone's Pro or RAW mode) show the picture saved
  inside them; the RAW file itself is kept untouched. Videos play quietly on a loop: click (or Space) to pause, drag along the line at the
  bottom to move through it, and the speaker (or M) for sound. GIFs move on their cards.
  Use ← → to move between items and Esc to close.
- **Several boards**: tick boards on the right when an item is open.
- **Notes**: bold, italic, bullet lists, headings. **Tidy up** turns messy text into a
  heading and bullet points (no AI, all on your PC). **Undo tidy** puts it back.
- **Bin**: **Move to Bin** keeps the item with its boards. Restore it from the Bin.
  **Empty Bin** deletes permanently and asks first.
- **Search**: Ctrl+F finds titles, notes, and what things are (e.g. "wallpaper", "black",
  "streetwear"). **New note**: Ctrl+N. Press **?** (or Library → Keyboard shortcuts) for every
  shortcut and gesture. Delete in an open item moves it to the Bin.

## Recognition (on your PC)

Notebook looks at every photo and video (by its preview) in the background and works out:

- **What it is**: outfit, wallpaper, icon, profile picture or other (photos of things, like
  a PC setup or a room, count as other). Each gets a main label
  and can have extra ones (a street photo can be an outfit and a profile picture).
- **For outfits**: the colours of the clothes (only the clothes, never the background) and
  the top two styles from **your style list**.
- **A proper name**: pictures called things like "Pinterest pin", "IMG_2031" or a long post
  title get a short name from what's in them ("Black hoodie and cargo pants", "Blurry red
  sky"). A name you type yourself, here or on your phone, is never changed. The old title
  still works in search (point at the date under the title to see it).

It runs on your graphics card and stays smooth while you use the app. A small line at the
bottom left says "Recognising 3 of 40…" while it works.

- **Filters**: the chips under the board name filter by where it came from (**My photos**,
  **Pinterest**, **TikTok**), type, colour and style. An open item also says "Saved from Pinterest"
  or "Taken 6 Mar 2026".
- **Correcting it**: open anything, click the line that says what it is (e.g. "Outfit ·
  Streetwear"), and use the dropdowns to fix a label. Your
  corrections are kept forever: a re-scan never changes them. **Use what the PC saw** undoes a correction.
  Colours work the same way: under **Colours**, click one to take it off or **Add a colour**.
  (The PC's own colours only count when they cover a fair part of the picture.)
- **Your styles**: the **Styles** chip lets you add your own styles or remove ones you never
  use. Outfits are looked at again for the new list.
- **Suggested** (left, under the boards, folded away until you click it): groups of outfits
  that go together, and matching sets of a wallpaper, an icon and a profile picture. Click one to look; **Keep as board**
  makes it a board, **Dismiss** hides it for good. Suggestions never move, change or delete anything.
- **Where the tools live**: `D:\Notebook Tools\models` (about 3 GB, downloaded once). With
  them there, recognition needs no internet at all.

## Saving from TikTok and Pinterest links

- **Paste a link** anywhere in the window (or into **Paste a TikTok or Pinterest link** at
  the top left) and it's saved to your notebook by itself: TikTok videos, TikTok photo
  slideshows (saved as one stack) and Pinterest image and video pins.
- If a save fails, you get a plain message and the link waits under **Links** to retry.
- **Check my links** (under Links) re-tests your last few saved links. Run it now and then,
  or whenever a save fails.
- **Update downloader** (under Links) updates the download tools. Nothing updates by itself.
- TikTok or Pinterest can change their sites and break saving at any time. That only stops
  new saves; everything already saved stays safe. The download part is kept separate, so a
  fix is usually a short job for Claude Code or Codex.
- The tools live in `D:\Notebook Tools\bin`. Downloading for personal use can go against
  those sites' rules; if that matters to you, get qualified advice.

## Pinterest panel

**Pinterest** (bottom left) shows the real Pinterest website inside Notebook. Sign in once
there yourself (it remembers you, separately from your normal browser). Open any pin and
press **Save to library**, or right-click a pin and choose **Save to Notebook**. Nothing is
saved unless you choose it. Promoted (sponsored) pins are taken out before they show. It opens
where you left it, and menus you open over it aren't hidden behind it.

**Hide AI pins** (the switch in the Pinterest toolbar, on by default): every pin picture you see
is checked once on your PC by two AI-picture detectors, and pins both are sure are AI-made are
quietly taken out (the toolbar counts them). Nothing is sent anywhere for this. In tests it
caught about 6 in 10 AI pictures and hid about 1 in 100 real photos by mistake, so some AI
pictures will still get through. New pages of pins can take a second longer to appear the first
time while their pictures are checked.
Pinterest's own "See fewer AI Pins" setting (in your Pinterest settings) helps too. Pinterest
sees what you browse there, just as it does in a browser.

## Ideas (For you)

Above every board there's **Saved | Ideas** (on All items, **Saved | For you**). Ideas are pins
from Pinterest picked for that board: "More like this" for pins you saved from Pinterest,
searches made from the board's name and what's on it, and on For you your own Pinterest home
feed too (sign in once in the Pinterest panel for that). Your PC then ranks them by how much they
look like the board, and leaves out promoted pins, AI-made pins (with **Hide AI pins** on) and
things you already have.

- **Save** (on a pin): saves it to the board you're on, like pasting its link.
- **×** (Not for me): the pin goes, and ones like it come up less.
- Click a pin for a close-up inside Notebook (← → for the next one): **Save**, **Open in
  Pinterest** or **Not for me**. Scroll down for more; **New ideas** fetches a fresh set.
- Ideas are stricter about AI than the Pinterest panel: anything the detectors think might be
  AI-made is left out (there are plenty of other pins to show instead).
- For you and the boards you've looked at this week are kept ready in the background (a minute
  after Notebook opens, then hourly), so they usually show straight away. A board's first ever
  Ideas take a few seconds; the very first after starting the PC can take up to about 15.
- On your phone, **For you** is the third tab on Home, and each board has **Saved | Ideas**. Tap
  a pin for **Save**, **Open in Pinterest** or **Not for me**. The phone gets them from your PC
  when it syncs, so it shows the last ones it got when you're out; a pin saved from the phone
  is downloaded by the PC and arrives with the next sync.
- Pinterest is only asked when you look at Ideas (or when they've gone stale for the phone), one
  board at a time, much like scrolling it yourself. This reads Pinterest's website the way the
  site does; Pinterest can change it at any time, and it isn't something to sell in an app.

## Keeping it safe

- **Back up every week** (Library menu): switch it on and choose a folder, ideally on another
  drive. The first copy is made straight away, then a new one whenever Notebook starts and the
  last is a week old. The newest three are kept; older automatic ones are deleted. Backups you
  make yourself are never touched.
- **Back up**: copies the whole library into a new dated folder and checks every file.
  Back up to a separate drive now and then (your B: drive if it's a separate physical
  drive, plus an occasional external drive).
- **Restore**: pick a backup folder, then where to put the restored copy. Your current
  library is left alone, and Notebook switches to the restored copy. To go back, use the
  folder button → **Open another library**.
- **Export**: makes a folder anyone can open without Notebook: `Media` (every photo and
  video, named by title), `Notes` (each note as a .txt file) and `boards.csv` (which
  boards each item is on; opens in Excel).

## Phone

Notebook on your phone can sync with this PC over your home Wi-Fi. Nothing goes to the
internet: the phone talks straight to the PC.

1. On the PC, click **Phone** (bottom left). A QR code and an 8-letter code appear.
2. Open Notebook on your phone, tap **Sync**, then **Scan code**, and point it at the QR code.
   (You can type the code instead.) Each code works once and lasts 10 minutes. **New code** makes another.
3. That's it. The phone stays paired, so you only do this once.

- The first time, **Windows may ask whether to allow Notebook** on the network. Choose
  **Allow** on private networks. If your phone still can't connect, open Windows Settings,
  Network & internet, Wi-Fi, and set your home network to **Private network**.
- **Keep Notebook ready for your phone** (on after you pair your first phone): Notebook
  starts quietly when Windows starts, and closing the window keeps it running as a small
  icon by the clock, so your phone can sync whenever the PC is on. Click the icon to open
  Notebook; right-click it and choose **Quit Notebook** to close it fully. Untick the option
  to go back to closing normally.
- **Unpair** in the Phone panel stops that phone syncing straight away. Pair it again with a new code.
- Syncing never uploads to the internet. It only works when the phone and PC are on the same Wi-Fi.
- **Show on phone**: everything shows on your phone unless you switch it off. Open an item and
  untick **Show on phone** (or pick several and choose **Hide from phone**). Your phone removes
  its copy at the next sync; the PC keeps it. Only the PC decides this.
- Things you delete for good (Empty Bin) are deleted on the other device too after the next sync.

## Video formats

Samsung MP4s (camera, downloads and screen recordings) play inside the app. If a
video ever says it can't play, it's still stored safely: use **Show file in folder**
to open it in another player.

## For future coding sessions

See `AGENTS.md` for how the code is laid out and how to check changes.
