# Dev kit

Everything you'd otherwise do in the popup or on `chrome://extensions`, from Spotify's page:
read the extension's state, change settings, run the popup's actions, forget cached results,
reload the extension. Built for testing by hand and for an agent driving the browser
(Claude in Chrome's JavaScript tool), which can't open extension pages.

Dev builds only. Production builds (`npm run build`, the store zips) compile it out; check
with `grep -r __skDev .output/chrome-mv3` (no output).

## Builds

| Command | Folder to load unpacked | Notes |
|:---|:---|:---|
| `npm run build:devkit` | `.output/chrome-mv3-devkit` | Standalone: needs no server. After a change, build again and call `__skDev.reloadExtension()`. Named "… (devkit)" in `chrome://extensions`. |
| `npm run dev` | `.output/chrome-mv3-dev` | Rebuilds and reloads on every change, but the extension only works on Spotify while the dev server runs. |

## Use

In the console of an `open.spotify.com` tab (or `javascript_tool`):

```js
await __skDev.help()                    // every op
await __skDev.status()                  // what the popup shows, plus settings, health, storage
await __skDev.state()                   // songs known, where each song's lyrics came from, the view
await __skDev.settings({ allLines: true })
await __skDev.mode('translated')
await __skDev.searchAgain()             // the popup's Search again
await __skDev.notThisSong(true)         // the popup's Not this song (false: Undo)
await __skDev.popup({ sk: 'reload', when: 'after-song' })
await __skDev.forget()                  // forget the playing song's cached results
await __skDev.fresh()                   // forget() + reload the page: a first play, again
await __skDev.clearCache()
await __skDev.resetData()
await __skDev.cacheKeys('nat:')         // cache keys, newest first
await __skDev.log(30)                   // the page script's decisions + the background's requests
await __skDev.reloadExtension()         // open Spotify tabs get the new scripts, no page reload
```

`log()` shows each background request with its time and outcome, e.g.
`restoreNative 1540 ms -> 33 lines from LRCLIB aligned [Malang Sajna 73K…]`.

## Cautions

- Open the lyrics the way listeners do: the player bar's Lyrics button
  (`[data-testid="lyrics-button"]`), which opens Spotify's expanded Now Playing view. The
  `/lyrics` URL still renders a lyrics page, but it isn't what the app shows (2026-11).

- `fresh()` and `popup({ sk: 'reload', when: 'now' })` reload the page: the music stops if
  that tab is the player. A second Spotify tab in the same browser is a remote; reloading it
  doesn't touch playback.
- Any script on open.spotify.com can call `__skDev` in a dev build. Load dev builds only in
  your own browser, never ship one.

## How it works

`src/devkit/`: `page.ts` (the API, MAIN world) → `window.postMessage` → `content.ts` (answers
page-side ops: status, state, settings, the popup's requests; forwards the rest) →
`chrome.runtime.sendMessage` → `background.ts` (cache, reload, the request log).
`DEVKIT` (`protocol.ts`) is `import.meta.env.MODE !== 'production'`.
