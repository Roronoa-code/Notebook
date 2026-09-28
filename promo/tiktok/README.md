# Notebook TikTok advert

17-second vertical advert, 1440 x 2560 (2K), 30 fps, H.264 + AAC, cut to an original 128 BPM track (`music.js`, synthesised from code). Built with the Product-Motion-Agent-Pack's method: one frame-driven renderer (`state = evaluate(frame)`, then `draw`), its `motion-core.js` maths, styleframes before the full render, and checks on the encoded file.

**Brief:** for people who save outfit and wallpaper ideas from TikTok and Pinterest, Notebook keeps them in one mood board on PC and phone. Proved by pasting a link, the picture landing on the board, being recognised, found by search, then shown on the phone.

**Identity:** Notebook's own fonts (Anton, Figtree, IBM Plex Mono from `renderer/fonts`), grain background, `#151515` surfaces, `#9D7BFF` accent, the app's ease `(.22,1,.36,1)` and spring.

| Beats (0.47 s each) | Shot |
|---|---|
| 0–4 | Hook: SCREENSHOTS. / PINS. / TIKTOKS. / EVERYWHERE., one word and one picture per beat |
| 4–8 | Drop: the pile snaps into the board, the rest of the board falls in. ALL IN ONE BOARD. |
| 8–14 | PASTE A LINK.: the link types, the new card springs out of the paste bar |
| 14–20 | IT KNOWS WHAT'S IN IT.: close-up, Outfit / Black / Streetwear land on beats |
| 20–26 | FIND ANYTHING.: search "black streetwear", non-matches drop on the beat |
| 26–31 | NOW ON YOUR PHONE.: the board flies into the phone and scrolls |
| 31–36 | Hit: notebook. wordmark, then hold |

## Commands (from the Notebook folder)

    node --test promo/tiktok/test.cjs
    node promo/tiktok/render.js                  # -> promo/tiktok/out/notebook-tiktok-1440x2560.mp4 (about 90 seconds)
    node promo/tiktok/render.js --stills 1,6.5   # single frames
    node promo/tiktok/render.js --serve          # preview player with scrubber

Needs Microsoft Edge and ffmpeg. Pictures come from `NOTEBOOK_PROMO_MEDIA` (default `D:\Notebook Tools\testset\candidates`); file names are listed in `ITEMS` in `film.js`.

## Limits

- The pictures are the recognition test set; where they came from and their licences are not recorded. Swap in your own photos before posting publicly.
- The music is original and generated here, so there are no rights issues. It's a simple synth loop; swap in a TikTok sound if you prefer (cuts are on a 128 BPM grid).
- The UI is redrawn from the real app's styles, not screen-recorded; the paste bar doubling as the search bar is a simplification (the app has two).
- The pack's exact reference article and clips were unavailable to its author, so this is principle-based original work, not a copy of that post.
