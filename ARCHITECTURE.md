# Architecture

Read [PROBLEM.md](PROBLEM.md) first: it says what this is for. This page says how.

## The one idea

Spotify's web player already has a good lyrics view: synced highlighting, smooth
scrolling, click-to-seek, theming, the expanded Now Playing view. **We never rebuild it.**
We only change what goes into it and how its text is drawn:

1. **What goes in: the network.** Spotify asks two endpoints about lyrics, and both are
   plain JSON over `fetch`:
   - `spclient.wg.spotify.com/metadata/4/track/{gid}`: track metadata. `has_lyrics` is
     present (true) only when Spotify has lyrics; without it the Lyrics button is disabled.
   - `spclient.wg.spotify.com/color-lyrics/v2/track/{id}`: the lines, with start times.
     Spotify also fetches the *next* song's lyrics ahead of time.

   For a song without lyrics, the page script adds `has_lyrics: true` to the metadata.
   Spotify then asks for its lyrics, gets a 404, and the page script answers instead with
   lyrics we found elsewhere, in Spotify's own format. Spotify renders them like its own,
   spinner and errors included. (Verified live, 2026-11-09.)

2. **How it's drawn: attributes and CSS.** Each line is a `[data-testid="lyrics-line"]`
   element wrapping one text element; both belong to React. We never add or remove nodes.
   We set `data-sk-main` (the processed line) and `data-sk-sub` (lines shown beneath) on
   the line element, and a stylesheet hides the original text and draws ours with
   `::before` / `::after`. Spotify's classes for past / current / future lines set colour
   and opacity on the line element, so our text inherits them.

   Decoration is **keyed by the line's text**, not by index or song: a line reading X
   shows the romanization of X. Any song's panel, mounted or sliding out, is always
   decorated correctly; there is no "current song" to get wrong.

## Native script

When Spotify serves a song's lyrics romanized (Latin lines, but the track's
`language_of_performance` is Hindi, Tamil, ...), the page script holds Spotify's response
for up to 5 s and asks for a copy in the song's own script (YouTube Music first once it
is wired in, then LRCLIB copies with a known duration). A copy must prove it is the same
song: romanized by us, it has to read like Spotify's lines (consonant-skeleton
similarity). Same number of lines: Spotify's timings are kept and only the text changes
("aligned"). Otherwise only a synced copy close in length is used, with its own timings.
An aligned result that arrives after Spotify has drawn its romanized lines still reaches
the screen: the content script maps each romanized line to its original-script line.

## Parts

```
page (MAIN world, document_start)        content (isolated world)            background (service worker)
 fetch hook                               bridge: page RPC <-> runtime         lyrics: LRCLIB, YouTube Music,
  metadata/4  -> report, add has_lyrics   line map: text -> processed            matching, cache
  color-lyrics 200 -> report lines        decorator: data-sk-* on lines        text: script detection,
  color-lyrics 404 -> ask, answer         mode pill (shadow DOM)                 romanizers, translation, cache
                                          settings (storage.sync)
```

- `src/page/`: runs in Spotify's own JavaScript world, so it sees Spotify's `fetch`.
  It cannot call extension APIs; it talks to the content script with `window.postMessage`.
- `src/content/`: owns what the user sees. Every set of lyrics that passes through the
  network (current song, prefetched next song, ours) is processed as soon as it arrives,
  so song changes are instant. Lines on screen that we have never seen are collected
  from the DOM and processed as a group (the fallback, never the main path).
- `src/background/`: everything slow or heavy: network lookups, the Japanese
  dictionary, translation, caches in `storage.local`.
- `src/shared/`: types, the message protocol (one typed table), settings.

## Rules

- One identity for a song: Spotify's base62 track id. One identity for a line: its text.
- No timers that guess at timing. No polling loops.
- No node that React owns is ever created, moved or removed by us.
- If something we depend on is missing, do nothing and report it; never break Spotify.
- No header spoofing or bot-check workarounds against any service.
