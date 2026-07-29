# Security Policy

## Supported versions

Only the **latest release** is supported. Desktop builds auto-update; Android is
sideloaded, so please confirm against the newest APK from
[Releases](https://github.com/Carlos-err406/croc-gui/releases/latest) before reporting.

## Where the boundary is

Crocodile is a GUI that drives the real [`croc`](https://github.com/schollz/croc) CLI —
it does not implement the transfer protocol, the encryption, or the relay handling.

- **Report to croc upstream** if the issue is in the protocol, the PAKE handshake, the
  relay, or croc's own file handling. A good test: does it reproduce with plain
  `croc send` / `croc` on the command line, with no GUI involved?
- **Report here** if the issue is in this app: how code phrases are generated or stored,
  how they reach croc, deep-link and `croc://` handling, clipboard and QR handling,
  transfer history, where received files are written, Android content-URI staging, the
  updater and its signature check, or anything the bundled binary's packaging affects.

## Reporting a vulnerability

**Please don't open a public issue.** Use either:

- GitHub's private reporting — the repo's **Security** tab → *Report a vulnerability*
- Email **carlosvilaseca406@gmail.com**, with `croc-gui security` in the subject

Helpful to include: affected version and platform, what an attacker can achieve, and
the steps or a minimal case that shows it. If it involves a code phrase or a link,
redact any real one.

This is a personally maintained project, so expect a human response time rather than a
corporate SLA — I'll acknowledge as soon as I see it and tell you what I can fix and
when. Please give me a chance to ship a fix before publishing. Credit in the release
notes is yours if you'd like it.

## Known, deliberate limitations

These are documented tradeoffs, not vulnerabilities — no need to report them:

- **macOS builds are not notarized**, so first launch requires right-click → *Open*.
- **Anyone holding the code phrase can complete the transfer** — that's croc's model.
  Treat a code, and any `croc://` or `https://` link containing one, as a one-time
  secret and send it over a channel you trust.
- **Nearby / discoverable mode advertises a one-time code over mDNS**, readable by
  anyone on the same network while it's on. Being discoverable *is* the consent step.
- **Transfer history stays on the device** and is not encrypted at rest beyond whatever
  the OS provides for app storage.
