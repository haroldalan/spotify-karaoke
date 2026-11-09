# Spotify Karaoke (next)

A clean-slate rebuild of Spotify Karaoke. It romanizes and translates lyrics inside
Spotify's web player and finds lyrics for songs Spotify has none for. Chrome first; Edge
uses the same build; Firefox comes later.

- [PROBLEM.md](PROBLEM.md): what this is for, in priority order. Every change is judged
  against it.
- [ARCHITECTURE.md](ARCHITECTURE.md): how it works. The short version: we never rebuild
  Spotify's lyrics view. We change the lyrics Spotify receives (network) and how each
  line's text is drawn (attributes and CSS).

## Build

```bash
npm install
npm run build        # .output/chrome-mv3
npm test
npm run typecheck
```

Load `.output/chrome-mv3` at `chrome://extensions` (Developer mode → Load unpacked).

## Live testing in Chrome

Branded Chrome ignores `--load-extension`, and Chrome for Testing can't play Spotify (no
Widevine). `tools/live/driver.mjs` therefore starts real Chrome over a debugging pipe and
loads the extension through CDP, using the test profile in `.live/chrome-profile`
(git-ignored).

1. Sign the profile in once, with plain Chrome (Spotify refuses a remote-controlled
   browser at login):
   `open -na "Google Chrome" --args --user-data-dir=$PWD/.live/chrome-profile`
   Sign in, then quit that window.
2. `node tools/live/driver.mjs` (it serves commands on 127.0.0.1:9444). Run driver and
   ctl commands on their own, not chained: Claude Code's allow rules
   (`Bash(node tools/live/driver.mjs:*)`, `Bash(node tools/live/ctl.mjs:*)`, in
   `~/.claude/settings.json`) only match whole commands.
3. `node tools/live/ctl.mjs eval '<js in the Spotify page>'`, `sw '<js in the service
   worker>'`, `shot`, `clickAt`, `reload '{"ext":true}'`, `shotTab '{"url":"popup"}'`,
   `quit`.

Before pressing play, check that nothing says "Playing on …" (the account is shared, so
Spotify Connect would move playback from your own player), and mute the test player.

`tools/probe/` is a tiny extension that records Spotify's lyrics-related network traffic
from page start. Use it to see what Spotify changed after a redesign.

## Status (2026-11-09)

Verified live in Chrome 156:
- Romanized / translated main line with the original beneath, Spotify's highlighting and
  scrolling intact; switching modes from the on-page switcher.
- Song changes: no undecorated or wrong-song line in any 100 ms sample, including while
  both songs' panels are mounted.
- Unsynced Spotify lyrics upgraded to a synced LRCLIB copy (same script).
- Songs without lyrics: Spotify asks for them after we claim `has_lyrics`, and renders
  ours. When nothing is found, Spotify shows its own "still working on lyrics" message.
- Native script: Spotify's romanized Tamil (Thangamey) and a Hindi song restored from
  LRCLIB, line for line, keeping Spotify's timings; Tum Hi Ho restored in Devanagari from
  YouTube Music (LyricFind, its own release timings).
- YouTube Music: header rules registered for the extension's own requests only; timed
  lyrics through the Android client; まどろみ (no Spotify or LRCLIB lyrics) now shows
  YouTube Music's (unsynced) lyrics.

Not done yet:
- Songs whose Spotify line breaks differ from every native copy stay romanized
  (alignment is line-for-line).
- Firefox build and live test.

`window.__skLog` in the Spotify page lists the page script's recent decisions.
