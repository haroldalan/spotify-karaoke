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
npm run build          # .output/chrome-mv3 (Edge: npm run build:edge)
npm run build:firefox  # .output/firefox-mv3 (Firefox 142+, MV3)
npm run zip && npm run zip:firefox && npm run zip:edge   # store zips + Firefox sources zip
npm test
npm run typecheck
npm run dev            # .output/chrome-mv3-dev, rebuilt and reloaded on every change
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
- See PRIVACY_POLICY.md for every service contacted and what is sent.

Live regression pass in the owner's Chrome (dev build, 2026-11-09):
- Hindi romanized from Devanagari; T / R keys; translation.
- Tum Hi Ho restored line for line from YouTube Music, shown with Spotify's own romanization.
- TRILLIUM HARDTEKK (no lyrics anywhere): the notice, Search again, "Still no lyrics".
  Spotify does not ask for lyrics again when its view is reopened, so newly found lyrics
  show after a reload (the notice offers it).
- Japanese (Midnight Pretenders): words grouped (nazoreba, oyogi tsukareta sakana no you ni).
- Skip to the next song: no undecorated line in any 100 ms sample, mid-slide included.
- GraphQL responses yield track details (50, 25, 11 ... tracks per response).
- Popup: status, cache size, language search.
Firefox (test profile, no playback): page hook, background lookups and romanized lines work.
- Songs without lyrics: Spotify asks for them after we claim `has_lyrics`, and renders
  ours. When nothing is found, Spotify shows its own "still working on lyrics" message.
- Native script: Spotify's romanized Tamil (Thangamey) and a Hindi song restored from
  LRCLIB, line for line, keeping Spotify's timings; Tum Hi Ho restored in Devanagari from
  YouTube Music (LyricFind, its own release timings).
- YouTube Music: header rules registered for the extension's own requests only; timed
  lyrics through the Android client; まどろみ (no Spotify or LRCLIB lyrics) now shows
  YouTube Music's (unsynced) lyrics.

Seamless-UI pass (2026-11-09, after a UI audit and a third-party one):
- The switcher is 3.1.6's capsule in 3.1.6's place, under the lyrics header; it hides on
  the artwork view and in narrow panels (the sidebar shows only the main line there).
- Lyrics we supply are credited in Spotify's own footer ("Lyrics provided by LRCLIB ·
  Spotify Karaoke"), keep the album colours and are marked dense for CJK/Indic scripts.
- The no-lyrics notice sits where the switcher does; the popup can Search again even
  when Spotify has disabled its Lyrics button.
- Spotify's mini player gets the same decoration.
- Popup: switches, a dropdown language picker with search, a one-line status with the
  details folded away, the playing song, footer credit. Verified with a stubbed API;
  the live check covered the capsule on Spring Day (romanized Korean, Hangul beneath).

"It just works" pass (2026-11-09, from docs/ux-audit-personas.md and the owner's two rules:
fewer choices, and not everything possible):
- One choice: Original / Romanized / Translated, plus the language (from the browser).
  The line beneath is decided: the original under romanized, the romanization under
  translated (the original for Latin-script songs). Finding lyrics and restoring scripts
  are always on. Gone: the "also show" switches, three other switches, Search again and
  Reload Spotify, the status details and cache button, the Alt+Shift shortcuts.
- Installing or updating adds the scripts to Spotify tabs already open; an older copy in
  the tab steps aside. Verified in the test Chrome: reinstalled with Spotify open, the
  sidebar line became "tteonaga" with no reload, one switcher, one stylesheet.
- The switcher shows only in the full lyrics view (not over the Now Playing sidebar),
  offers Original / Translated on Latin-script songs, and fades after 3 s without mouse
  movement. O / R / T only with the lyrics view open, and in the mini player.
- Pending translations show the romanized line, not bare text; the Japanese dictionary
  loads when a Japanese song starts; a native-script copy that arrives late is used at
  the next load. "Add lyrics" makes the next load search again.
- Verified live in the owner's Chrome (Haru Haru): no switcher over a 420 px sidebar, O
  ignored on the home page, fade and return, Romanized (Hangul beneath) and Translated
  (Tamil, romanization beneath).

Not done yet: see the batches below.

## Fix plan (from three audits, 2026-11-09)

| Batch | Scope | State |
|---|---|---|
| 0 | First commit, CI, tests for hook, bridge, cache, Google, YouTube Music | done |
| 1 | Romanization: Japanese by word, offline Thai, Indic fixes, per-line scripts | done |
| 2 | Never the wrong song (song-scoped results); caching that keeps what's good | done |
| 3 | Any Spotify host, GraphQL fallback, settings first, time pairing, Spotify's romanization | done |
| 4 | Header rules scoped to the extension, request validation, privacy policy, license | done |
| 5 | UX: no-lyrics notice with Search again, status, cache clear, language search, O/R/T keys | done |
| 6 | Firefox (MV3, the published add-on id), version 4.0.0, release workflow | done |

Known limit: lyrics drawn with CSS can't be selected or copied (the cost of never touching
React's nodes). Chrome and Firefox include CSS-generated text in what they give screen
readers; not yet checked with an actual screen reader.

`window.__skLog` in the Spotify page lists the page script's recent decisions.
