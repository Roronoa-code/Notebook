# Notebook motion film

A 24-second, 1920 x 1080, 24 fps film about Notebook, made in the style of a 3D motion-design reel (camera swoops, whip pans, speed-line bursts, puffy 3D words, typed captions, a halftone ring, a stuttering finish), in Notebook's own colours and with the real PC and phone apps on its screens. The music is original and made in code, cut to 120 BPM, with every whoosh, pop, click and impact placed on the frame it belongs to.

Nothing in it is a mock-up of the app: the desktop screens are screenshots of the real Electron app (`capture-desktop.js`), and the phone screens are the real phone screens run with their PC-preview bridge (`capture-phone.js`). Everything else (the desk, the monitor, the phone body, the glass Save button, the cursor, the ribbon, the words) is built in 3D with three.js and rendered frame by frame.

## Shots

| Time (s) | Shot |
|---|---|
| 0–4.5 | Top-down desk: the phone (real home screen) among saved photos and a note. Three notifications pop off the phone on the beat, then everything lifts and tumbles; whip pan out. |
| 4.5–9 | The PC: the cursor flies to the real paste bar, the giant glass **Save** button is clicked (letterbox), then **IT'S ON YOUR BOARD!!!** is typed while the real board's cards burst out of the screen. |
| 9–9.25 | Speed-line burst. |
| 9.25–11 | Close-up: the cursor draws a violet ring round the parka and the labels pop up (Outfit, Orange, Parka, Streetwear). |
| 11–13 | Violet halftone flash, then an overhead board with a ribbon sweeping through and lifting the cards. |
| 13–15.4 | Pins fly in, **so many ideas.** in puffy 3D, push through. |
| 15.4–18.5 | Burst, then the phone floating in violet haze in front of **Anywhere.**; the info card slides up (One board. PC and phone.). |
| 18.5–20.3 | A board tile, the halftone ring and **sorted.**; the tile opens. |
| 20.3–21.7 | The real app: search "black", then an open photo with its labels. |
| 21.7–24 | **save!!! / sort. / notebook.** and the wordmark. |

## Commands (from the Notebook folder)

    node promo/motion/photos.js                          # fetch the 40 photos (once)
    node promo/motion/capture-desktop.js                 # real desktop screens (Linux: run under xvfb-run)
    node promo/motion/capture-phone.js                   # real phone screens
    node promo/motion/render.js --stills 2,7.1 --scale 0.5   # quick looks -> out/stills
    node promo/motion/render.js                          # the film -> out/notebook-motion-1920x1080.mp4
    node promo/motion/music.js                           # the music on its own -> out/music.wav
    node --test promo/motion/test.cjs                    # checks

Needs the app's devDependencies (electron, playwright-core), ffmpeg on PATH, and a browser: Microsoft Edge on Windows, otherwise Playwright's Chromium. The render uses the browser's software WebGL, so it takes a while (roughly an hour for the whole film on four cores). `--from` and `--to` (seconds) render part of it.

## Files

- `timeline.js`: shots, the sound cues and the easing maths (shared by the picture and the music).
- `shots.js`: the eight 3D shots. `kit.js`: the parts they are made of. `hud.js`: the flat layer (captions, bursts, the info card, the finale) and the post settings. `film.js`: loading, motion blur (several exposures per frame) and the finish (colour fringe, halftone corners, grain, letterbox).
- `music.js`: the soundtrack. `photos.js`: the photo list. `browser.js`: finds a browser.
- `vendor/`: three.js r170 and its loaders, opentype.js (MIT). `fonts/`: Figtree Black and Anton as TTF for the 3D words (OFL, made from `renderer/fonts`).

## Credits and limits

- Photos are from Unsplash (free to use, via picsum.photos): Alexander Shustov, Luke Pamer, Benjamin Combs, Lechon Kirb, Matthew Wiebe, Patryk Sobczak, Todd Quackenbush, Joshua Earle, Eli DeFaria, Jennifer Trovato, Caleb Ekeroth, Amanda Sandlin, Roksolana Zasiadko, Léa Dubedout, Marcelo Quinan, Greg Rakozy, ahmadreza sajadi, Pierre Bouillot, Andras Toth, Tim Marshall, Samuel Zeller, Michael Baird, Joshua Hibbert, Philippe Wuyts, Christian Joudrey, Noah Rosenfield, Kamesh Vedula, Marat Gilyadzinov, veeterzy, Drew Patrick Miller, Alexandre Perotto, Anthony Delanoix, Erez Attias, Loudge, Ben Dumond, Sam X, sergee bee.
- The reference video's music isn't used (it isn't ours to use); this track copies its shape (soft start, drop on the click, airy break, stuttering finish), not its notes.
- The labels in the close-up (Orange, Parka) are what the recogniser is for; the desktop screenshots use the app's stand-in recogniser, so their labels come from file names.
- The Save button is a stylised, oversized version of the app's paste bar (the app saves as soon as a link is pasted).
