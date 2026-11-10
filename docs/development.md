# Spotify Karaoke: development

Spotify Karaoke romanizes and translates lyrics inside Spotify's web player, restores the
original script when Spotify serves romanized lyrics, and finds lyrics for songs Spotify has
none for. Version 4.0.0 is a clean-slate rebuild of 3.x. Chrome and Edge
use one build; Firefox (142+) has its own MV3 build.

- [PROBLEM.md](../PROBLEM.md): what this is for, in priority order. Every change is judged
  against it.
- [ARCHITECTURE.md](../ARCHITECTURE.md): how it works. The short version: we never rebuild
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
extension. See [docs/devkit.md](devkit.md).

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

Before pressing play, check that nothing says "Playing on …": if the test profile's Spotify
account is playing somewhere else, Spotify Connect moves playback. Mute the test player.

Firefox: `SK_BROWSER=firefox node tools/live/driver.mjs` runs the same driver on Firefox with the
Firefox build (`.output/firefox-mv3`) and its own profile (`.live/firefox-profile`); see the notes at
the top of `tools/live/driver.mjs`.

`node tools/live/headers.mjs` shows the headers Chrome sends on the extension's Google Translate
request, in a throwaway profile (one real request to Google: run it rarely).

`tools/probe/` is a tiny extension that records Spotify's lyrics-related network traffic
from page start. Use it to see what Spotify changed after a redesign.
