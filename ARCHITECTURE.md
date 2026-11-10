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
   A decorated line becomes a column of three slots: Spotify's own text, our `::before`
   and our `::after`. The attributes `data-sk-a` (the romanization, or the original script
   on a restored song), `data-sk-b` (the translation) and `data-sk-big` (which slot is the
   main line: a, b, or c for Spotify's own text) tell the stylesheet what to draw and how;
   `data-sk-hide`, `data-sk-alias`, `data-sk-dir` and `data-sk-compact` (Spotify's small
   lyrics card, the mini player, narrow views) refine it. Spotify's classes for past /
   current / coming lines set colour and opacity on the line element, so our text inherits
   them.

   Decoration is **keyed by the line's text** within a song: a line reading X shows the
   romanization of X. A lyrics list on screen belongs to the known song that has at least
   half of its lines, so any song's panel, mounted or sliding out, is decorated from its own
   song and never another's. When our lines change height (a mode switch, a translation
   arriving), the content script scrolls by however far the highlighted line moved, so
   Spotify keeps following the song.

## Native script

When Spotify serves a song's lyrics romanized (Latin lines, but the track's
`language_of_performance` is Hindi, Tamil, ...), the page script asks for a copy in the
song's own script: YouTube Music and LRCLIB at the same time, YouTube Music's copy tried
first. Not when most of Spotify's lines are already in that script: the lines that look
romanized are then hooks or ad-libs ("ddu-du ddu-du"), not a romanized song. A copy must
prove it is the same song: romanized by us, it has to read like Spotify's lines
(consonant-skeleton similarity), line by line, or, when the two break their lines
differently (one joins what the other splits, a chorus written once), as a whole text: most
of Spotify's text in the copy, most of the copy's in Spotify's, most of Spotify's lines each
inside one or two of the copy's, and, both timed, enough of them starting on time (a copy
timed to another recording would play out of sync). A song remembered as having no copy is
looked up again once when the judging changes (`JUDGE_VERSION`). The copy is shown as it is,
with its own lines and timings. Same number of lines ("aligned"): it can also go over
Spotify's lines, on Spotify's timings, when it arrives after Spotify drew them.

The page script holds Spotify's response for 1.5 s for the song playing, and up to 12 s for
a song Spotify fetches ahead of time (nobody is reading it yet; once it starts playing, at
most 1.5 s more). An aligned copy that arrives after Spotify has drawn its romanized lines
still reaches the screen: the content script maps each romanized line to its
original-script line. A copy with its own line breaks waits for the song's next load.

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
  Our one node in Spotify's tree is the switcher's host, appended to the element holding
  the lyrics view: zero-size and absolutely placed, so it takes no part in the view's layout.
  Spotify opens and closes that view with a view transition that draws it as one layer above
  the page; on body, the switcher showed only once the animation ended (2026-11-10).
- If something we depend on is missing, do nothing and report it; never break Spotify.
- YouTube Music and Google Translate's main endpoint are the exceptions to plain requests.
  YouTube Music serves timed lyrics only to its Android app, and refuses an extension's
  Origin; Google Translate is asked as its Android app (`client=at`, the app's User-Agent;
  the owner's decision, 2026-11-10). Both are made as that client, with header rules limited
  to this extension's own background requests (`tabIds: [none]`, `initiatorDomains: [this
  extension]`). YouTube Music kept by the owner's decision (2026-11-09). No
  captchas or sign-ins are worked around anywhere.
