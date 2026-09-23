# Phone ↔ PC sync (protocol v1)

Phone and PC talk directly over the home Wi-Fi. There's no cloud and nothing leaves the network. The PC is the hub: it runs a small HTTP server while Notebook is open, and the phone connects to it.

## Library format (both sides)

Both sides keep the same library folder layout: `library.json`, `media/`, `thumbs/`. Version 2 of `library.json` adds three things (the PC migrates v1 on load):

```json
{
  "app": "Notebook", "version": 2,
  "boards": [{ "id": "uuid", "name": "Outfits", "updatedAt": "ISO" }],
  "items":  [{ "id": "uuid", "kind": "photo|video|note", "title": "…", "file": "media/<id>.jpg", "thumb": "thumbs/<id>.jpg",
               "w": 1080, "h": 1350, "duration": 12.3, "originalName": "…", "size": 123, "html": "…", "caption": "…",
               "importedAt": "ISO", "updatedAt": "ISO", "boards": ["boardId"], "deletedAt": null, "stack": null, "stackIn": null, "phone": false }],
  "tombstones": { "items": [{ "id": "uuid", "at": "ISO" }], "boards": [{ "id": "uuid", "at": "ISO" }] }
}
```

- Every change that should sync bumps the item's `updatedAt`. That covers title, html, caption, boards, moving to the Bin (`deletedAt` set) and restoring. Making a thumbnail (`thumb`, `w`, `h`, `duration`) does **not** bump it.
- Boards carry `updatedAt`, set on create and rename. The migration sets missing ones to `createdAt` (or now).
- **Tombstones** record permanent removals so the other side removes them too:
  - Emptying the Bin adds an item tombstone.
  - Deleting a board adds a board tombstone.
  - Tombstones older than 90 days are dropped.
- **Stacks:** items with the same `stack` id (an id, or `null`/missing) show as one stack in All. `stackIn` is the board the stack was made in (a board id, or `null`/missing for All): inside a board, a stack only shows grouped if its `stackIn` is that board; otherwise its items show as loose cards there. Stacking inside a board sets `stackIn` to it; stacking in All keeps the `stackIn` of any stack it joins. Unstacking clears both. Stacking and unstacking bump `updatedAt` like any edit.
- **Show on phone:** `phone: false` means the PC doesn't send the item to the phone (missing means shown). Only the PC sets it: the PC ignores `phone` from the phone and keeps its own value even when the phone's copy is newer. It doesn't bump `updatedAt`. The phone removes items that stop arriving (and their files), as with any item missing from the answer. Exception: a hidden item whose file the PC is still waiting for keeps being sent until it's uploaded, so nothing is lost.
- **Recognition:** `ai` is what the PC recognised (type, colours, styles). It's device-local like `thumb`: it doesn't bump `updatedAt`, and the PC keeps its own `ai` when the phone's copy is newer. `labels` are the user's corrections (`main`, `extra`, `styles`); they bump `updatedAt` and sync like any edit, and a re-scan never changes them.
- `file` is always `media/<itemId><ext>`, lower-case extension, identical on both sides. `thumb` is device-local: each side makes its own.

## Discovery (finding the PC after its IP changes)

- The PC listens on **UDP 47822**.
- The phone sends the datagram `NOTEBOOK_DISCOVER` to the broadcast address `255.255.255.255:47822`.
- The PC replies by unicast to the sender with this JSON: `{"app":"Notebook","pcId":"…","name":"Mani's PC","port":47821}`.
- The phone keeps the last working host and falls back to discovery when it can't connect.

## HTTP API (PC, default TCP port 47821)

These rules apply to every endpoint:
- **Local network only:** the server rejects any remote address that isn't loopback or private (10/8, 172.16/12, 192.168/16, 169.254/16), with 403.
- **JSON:** request and response bodies are JSON, except media.
- **Auth:** everything except `/api/pair` requires `Authorization: Bearer <token>`. An invalid or missing token gets 401 `{"error":"not paired"}`.
- **Errors:** errors are `{"error":"plain English message"}` with a 4xx or 5xx status.

### Pairing

- The PC's **Phone** panel shows a QR code for the text `notebook://pair?h=<ip1>,<ip2>&p=<port>&c=<code>&id=<pcId>`. The same pairing code also appears as text, for typing in by hand.
  - `code` is 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, valid for 10 minutes, and can be used once.
  - `h` lists the PC's private IPv4 addresses, most likely first, with virtual adapters left out.
- `POST /api/pair` with `{ "code": "ABCD2345", "deviceId": "uuid", "deviceName": "Galaxy S25 Ultra" }`:
  - Success returns `200 { "token": "<64 hex>", "pcId": "…", "pcName": "…" }`.
  - A wrong or expired code returns `403 { "error": "That pairing code is wrong or has expired. Show a new one on the PC." }`. Wrong codes are rate-limited to 10 per minute.
- The PC stores paired devices in its own settings file (**not** in the library) as `{ deviceId, name, tokenSha256, pairedAt, lastSyncAt }`, and only a SHA-256 of the token. The Phone panel lists paired phones with an **Unpair** button.

### Health

`GET /api/ping` returns `200 { "ok": true, "pcId": "…", "pcName": "…", "items": <count> }`.

### Sync (metadata)

`POST /api/sync` takes the phone's whole library metadata (no media bytes):

```json
{ "deviceId": "uuid", "boards": [...], "items": [...], "tombstones": { "items": [...], "boards": [...] } }
```

The PC merges this with its own library, saves it, and returns the merged result:

```json
{ "boards": [...], "items": [...], "tombstones": {...}, "pcNeeds": ["itemId", ...], "serverTime": "ISO" }
```

**Merge rules** (the PC does all merging; the phone just adopts the result):
1. **Tombstones:** take the union of both sides. For the same id, keep the latest `at`.
2. **Boards:** take the union by id, and the higher `updatedAt` wins. A board with a tombstone whose `at` is at or after the board's `updatedAt` is removed.
3. **Items:** take the union by id, and the higher `updatedAt` wins the whole item. The exceptions are `thumb`, which always stays as the receiving side's own value, and `w`, `h` and `duration`, which fill in from whichever side has them. An item with a tombstone whose `at` is at or after its `updatedAt` is removed, and the PC deletes its media and thumb files.
4. **Boards on items:** any item's `boards` entries that point to boards no longer present are dropped.
5. **What the PC is missing:** `pcNeeds` lists the ids of merged items that have a `file` the PC doesn't have on disk.

The phone then:
- replaces its metadata with the merged result, keeping its own `thumb` values;
- downloads the media it's missing;
- uploads what's in `pcNeeds`.

### Media

- **Download:** `GET /api/media/<itemId>` streams the file with the right `Content-Type`, `Content-Length` and `X-Notebook-File: media/<id><ext>`. It returns 404 if the PC doesn't have it.
- **Upload:** `PUT /api/media/<itemId>` takes the raw file bytes as the body, with an `X-Notebook-Size` header.
  - The PC checks the id is a known item whose `file` it lacks, writes to a temporary file, checks the size, then renames the temporary file into `media/<id><ext>`.
  - It returns `200 { "ok": true }`, or 400/409 with an error.
  - The upload body limit is 2 GB.
- Thumbnails are never transferred. Each side makes its own.

## Security notes

- The token is 32 random bytes, and the PC keeps only its hash.
- Traffic is plain HTTP on the home network only, so it isn't encrypted against someone already on your Wi-Fi. That's the same trade-off as Deck Bridge.
- Pairing needs the code shown on the PC screen, and the code expires after one use or 10 minutes.
- Unpairing on the PC invalidates the token straight away.
