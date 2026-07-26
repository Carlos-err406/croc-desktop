# Croc Desktop — Backlog

Ideas parked for later, roughly prioritized. Not commitments. Where a feature spans
repos, "Repos" lists them (desktop = this repo, fork = Carlos-err406/croc-app, pages =
carlos-err406.github.io). Feasibility notes call out croc's own constraints.

---

## Next up (flagged 2026-07-25)

### ~~1. Reverse pairing — "Receive with QR" / *send to me*~~ — SHIPPED (desktop, v2.2.0)
- Desktop: the Receive screen's "Or have them send to you" mints a code and shows a
  QR + copy-link encoding `croc://send?code=…`; the opener lands on **Send** with the
  code pre-filled. Send gained a "Scan their code" button. Pages serves `/croc/send`.
- **DEFERRED — croc-app parity:** the Android fork does NOT yet emit or handle `send`
  intents. To reach parity it needs: `sendDeepLink`/`sendLink` builders, an `action`
  field on `ReceiveTarget` (its parser currently assumes receive), routing a scanned /
  OS-opened `send` intent to the Send screen with the code pre-filled, and a
  "have them send to you" invite panel with a QR. Until then, a desktop invite scanned
  by the phone app will be read as a plain code (it extracts `?code=` regardless), so
  the phone would try to *receive* rather than send — worth fixing before advertising
  the feature cross-platform.

### ~~2. Nearby peers — codeless LAN send~~ — SHIPPED (desktop, v2.4.0)
- **Model chosen (after a spike): advertise-a-code, NO listener.** A receiver toggling
  *Discoverable* mints a one-time code and advertises it in its mDNS TXT record
  (`_croc._tcp.local.`, with device name + croc version); a sender browses, picks the
  peer, and adopts the advertised code. That's the whole handshake — no custom protocol
  and no always-on LAN service to harden. Being discoverable IS the consent step.
- **Spike findings (verified live, two processes):** advertise + browse works on macOS
  and TXT survives intact. mDNS returns an *unordered* address set including loopback
  and `fe80::` link-locals, so addresses must be ranked (routable IPv4 first) — taking
  any one can hand back `127.0.0.1`. Peers also re-resolve repeatedly as more addresses
  are learned, so key them by fullname and update rather than append.
- **`--local` is NOT needed** for nearby transfers: croc already does LAN discovery in
  parallel by default, so adopting the code is sufficient.
- **DEFERRED — croc-app parity:** the phone app neither advertises nor browses, so
  nearby only works desktop↔desktop today.
- **Known limits:** needs multicast, so it won't work over most phone hotspots (same as
  local-only mode); while discoverable, anyone on the network can read the code and send
  to you (the auto-accept/review setting still gates whether files land unattended).

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
