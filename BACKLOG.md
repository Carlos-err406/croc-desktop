# Croc Desktop — Backlog

Ideas parked for later, roughly prioritized. Not commitments. Where a feature spans
repos, "Repos" lists them (desktop = this repo, fork = Carlos-err406/croc-app, pages =
carlos-err406.github.io). Feasibility notes call out croc's own constraints.

---

## Next up (flagged 2026-07-25)

### 1. Reverse pairing — "Receive with QR" / *send to me*
- **What:** On the Receive screen, generate a code + QR + link that means "scan to send
  me a file." The other person scans/clicks → their app opens the **Send** screen
  pre-filled with that code → they pick files and send. Completes the QR-ecosystem
  symmetry (today only senders can be scanned).
- **Why:** Nails the "hey, just send that to me" flow without the receiver reading a code aloud.
- **Approach:** A `croc://send?code=<code>` (and https `…/send?code=`) intent. The
  scanner/deep-link handler routes `send` intents to the Send screen with the code
  pre-set (`customCode`) and waits for file selection; `receive` intents keep today's
  behavior. Receiver side just runs a normal `croc` receive on that code. Reuse
  `parseReceiveTarget` → generalize to `parseCrocIntent` returning `{action, code, …}`.
- **Feasibility:** Clean. croc codes are symmetric (whoever sets the code first is fine),
  so no protocol issue. The Pages page needs a `/send` route (or a `?action=send` param)
  to hand off `croc://send?code=`.
- **Effort:** Medium. **Repos:** desktop, fork, pages.

### 2. Nearby peers — codeless LAN send ("AirDrop for croc")
- **What:** List other croc devices on the same network and send with one tap, no code.
- **Why:** Biggest "wow"; leverages the local-mode infra.
- **Approach / feasibility — HAS REAL UNKNOWNS:** croc pairs by **code**, not by
  browsing peers, so this needs a discovery + auto-handshake layer *on top of* croc:
  each app advertises an mDNS service (name + an auto-generated one-time code); the
  sender browses, picks a peer, and both sides transfer on that auto-code (ideally in
  `--local` mode). Requires: an mDNS advertise/browse implementation (croc's
  `peerdiscovery` is internal to a transfer, not a general browse), a small pairing
  handshake, and UI for the peer list. Only works where mDNS/multicast is allowed
  (same limitation as local mode — not phone hotspots).
- **Effort:** Large / spike first. **Repos:** desktop, fork.

### 3. Send to multiple recipients at once
- **What:** Share one code with several people; show "3 of 5 received."
- **Feasibility — CONSTRAINED by croc:** croc rooms are **1:1** — a room holds the
  sender + one receiver; a third client gets "room full" (croc `tcp.go`). So true 1:N
  in a single room is **not** supported. Implementation = **sequential re-sends of the
  same code**: after a receiver completes, re-offer the same code (like the existing
  "Add more" / re-send flow) and increment a received-count, until the user stops.
  Each recipient still transfers one at a time.
- **Why:** Handing a file to a room without re-reading the code each time.
- **Effort:** Medium (mostly a send-loop + count UI on top of existing re-send). **Repos:** desktop (fork later).

---

## Other ideas (unsorted)

**Speed & automation**
- Tray / menu-bar quick-send + global hotkey (send a file, clipboard, or screenshot without opening the window).
- Watch-folder auto-send (drop into a folder → auto-send).
- Send queue (line up several independent sends).

**Receive & post-transfer**
- Preview incoming before accepting (file tree + total size, in review mode).
- Drag received files out to Finder/Explorer.
- Notification actions (Open / Reveal straight from the toast).
- Auto-route received files by type; auto-open received text/image.
- Per-transfer download folder.

**Power & durability**
- Power-send flags: upload throttle (`--throttleUpload`), exclude/.gitignore on folder sends (`--git`/`--exclude`), per-send zip toggle.
- Resume across app restart (persist in-flight transfer through quit/crash).

**Trust**
- Verification words: surface croc's PAKE as a short confirm phrase both sides eyeball (anti-MITM assurance).
- App lock (password/biometric); ephemeral mode (auto-clear history + downloads after N).

**Reach & polish**
- Localization (i18n) — app is English-only.
- Onboarding / first-run tour; theme accents.
- Run-a-relay: one-click local relay host for a group/office.

---

## Technical follow-ups & known limitations

- **Embed `relay` in links** + generate `ip` (needs LAN-IP detection): the link parsers
  already tolerate `relay`/`ip`; nobody emits them yet. Would let a custom relay or a
  direct peer IP ride the QR/link.
- **Pages forwards `relay` already; add `ip`** if/when IP embedding ships.
- **Fork parser parity:** desktop `parseReceiveTarget` tolerates `ip`; the fork's reads
  `local`+`relay` only — add `ip` when IP embedding lands so they stay symmetric.
- **Windows/Linux "Open With" as a top suggestion:** `bundle.fileAssociations` is
  extension-based and can't express "any file/folder" like macOS `public.item`; today
  the app is reachable via "Open With → Other Application" (argv handling works), not a
  top suggestion.
- **Upstream Android PR #23** (Dking08/croc-app): fork branch `deeplink-croc-scheme`
  not yet opened as a PR. After it merges + upstream releases, flip the Pages APK
  download link from the fork to upstream.
- **Retina DMG background:** must be 2× pixels tagged 144 DPI (Finder reads it as
  points → fits the window AND stays crisp). A 1× background upscales/pixelates on retina.
