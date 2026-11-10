# Spotify Karaoke (next)

Spotify Karaoke romanizes and translates lyrics inside Spotify's web player, restores the
original script when Spotify serves romanized lyrics, and finds lyrics for songs Spotify has
none for. A clean-slate rebuild (version 4.0.0) of the published extension. Chrome and Edge
use one build; Firefox (142+) has its own MV3 build.

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
npm run build:devkit   # .output/chrome-mv3-devkit, standalone, with the dev kit
```

Dev builds carry a dev kit: `__skDev` in the Spotify page's console reads the extension's
state, changes settings, runs the popup's actions, forgets cached results and reloads the
extension. See [docs/devkit.md](docs/devkit.md).

Load `.output/chrome-mv3` at `chrome://extensions` (Developer mode → Load unpacked).

To rebuild the Firefox add-on from the sources zip (what Mozilla's reviewers do): Node 22,
`npm ci`, then `npm run build:firefox`; the add-on is `.output/firefox-mv3`. The list of
bundled packages and their licences is `public/THIRD_PARTY_NOTICES.txt` (regenerate with
`npm run licenses` after changing dependencies).

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

`node tools/live/headers.mjs` shows the headers Chrome sends on the extension's Google Translate
request, in a throwaway profile (one real request; see docs/google-translate-tests.md).

`tools/probe/` is a tiny extension that records Spotify's lyrics-related network traffic
from page start. Use it to see what Spotify changed after a redesign.

## Status (2026-11-10, evening)

Release candidate 4.0.0. 302 unit tests pass, `tsc` is clean, Chrome/Edge/Firefox build, the
production build has no dev kit.

Since the morning's full pass ([docs/live-check-2026-11-10.md](docs/live-check-2026-11-10.md)),
22 commits and a pre-release review of them (background, page, content, popup). Its
findings, fixed and each checked live in the owner's Chrome (dev-kit build): copies timed to
another recording refused; songs already in the listener's language left alone; a line
Google echoes is no translation; no script search for songs Spotify serves in their script;
"chh" and Gurmukhi's addak romanized right (cache version 6). New since: Google Translate's
main endpoint asked as its Android app (`tools/live/headers.mjs` shows the headers on the
wire), and copies judged by their whole text when line breaks differ.

The same evening, as a listener would (search, play, Spotify's own controls, the switcher,
the R key): Gurmukhi, Korean, Japanese, Cyrillic (a song Spotify has no lyrics for), Arabic
(Google's romanization), English and Spanish songs; Two lines, All three lines, a second
target language; no lyrics anywhere (notice, Search again); Wrong lyrics? and Undo; a
script restored on a first play; song changes; the sidebar card; an extension reload.

Firefox 159 (production add-on, `SK_BROWSER=firefox node tools/live/driver.mjs`, its own test
profile, as a remote of a Chrome player): the page hook; Devanagari restored from LRCLIB and,
with the Android header rule, from YouTube Music; romanized ("kuchh"), translated through
Google; the switcher; the credit line. Not seen in Firefox: a song Spotify has no lyrics for,
the no-lyrics notice, playback in Firefox itself (Spotify's device sync didn't follow an
automated Firefox). The popup page renders in the production build (test Chrome).

Not run live: the Alt+Shift commands; the mini player (Premium). Open owner decisions: see
docs/live-check-2026-11-10.md ("Owner decisions").

Earlier passes, kept for reference (2026-11-09/10). Verified live in Chrome 156:
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

UX pass (2026-11-09/10, a persona audit with the owner's decisions; docs/ux-audit-personas.md §10):
- Finding missing lyrics and restoring the original script are always on.
- "Two lines" (on by default): the original beneath the main line; off, the main line alone.
  An update from 3.1.6 keeps its "Dual lyrics" choice.
- "All three lines": original, romanization and translation in every mode; the switcher
  leaves the page, and the Two lines and switcher switches grey out and keep their settings.
- Popup: the mode, the language (Common languages first), the three switches with a description
  each, a status card with the playing song (Search again; "Wrong lyrics?" with Undo, sending
  a song back to Spotify's own lyrics; Reload now / After this song), Storage with Clear cache
  and Reset data, the Star card and the credit footer. Checked with a stubbed API.
- Open Spotify tabs pick up the extension on install and update, without a reload.
- Verified live: all three lines, and the two-line Translated view, on Kesariya; the switcher
  offers only Original / Translated on a Latin-script song and floats over the lines, like
  Spotify's own Sync button. Wordless lines (♪) are left as Spotify draws them.
- Native script on a first play: YouTube Music and LRCLIB are searched at once; a song not
  playing yet may wait up to 12 s; a line-for-line copy that comes after Spotify drew its
  romanized lines is put on screen right away (owner's call). Seen live: Malang Sajna in
  Gurmukhi (cached). Not yet seen live: a first play.

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
