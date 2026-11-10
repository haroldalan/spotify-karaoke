# Problem statement

Every design decision in this project is checked against this page. If a feature,
abstraction or workaround does not serve one of the needs below, it does not go in.

## Who it is for

People who listen to music on **Spotify's web player** (open.spotify.com) in languages
whose script they cannot read, or whose words they do not understand: K-pop, J-pop,
Bollywood, Punjabi, Tamil, Thai, C-pop, Russian, Arabic listeners; diaspora kids who
speak a language but cannot read its script; language learners; and anyone who wants
to sing along.

## The needs, in priority order

1. **Read it (romanization).** Show any non-Latin lyric line phonetically in the Latin
   alphabet, so the listener can sing along. This is the core of the product.
2. **Understand it (translation).** Show each line translated into the listener's
   language. Equal second core feature.
3. **See both at once.** The processed line (romanized or translated) is the main,
   highlighted line, with the original beneath it. Optionally all three stacked:
   original, romanized, translated.
4. **Lyrics where Spotify has none.** When Spotify says "lyrics not available", find
   synced lyrics elsewhere (YouTube Music first, then LRCLIB) and show them in Spotify's
   lyrics view, in time with the music.
5. **The right script (bonus).** When Spotify serves romanized lyrics for a song written
   in its own script (common for Hindi, Punjabi, Thai), restore the original script, so
   romanization and translation work from the real text. Only when the copy found
   matches the song (duration within 3 s, about the same line count).

## What "works" means

- **Inside Spotify, looking like Spotify.** No separate window or sidebar. The lyrics
  stay Spotify's lyrics view: its fonts, colours, highlighting, scrolling, click-to-seek.
- **In time.** The highlighted line follows playback, including after seeking or
  skipping.
- **Instant where it can be.** Romanization is computed locally: under ~100 ms for a
  song. Translation is one network round trip the first time and instant from cache
  after that.
- **Never the wrong song.** No frame where one song's lyrics, romanization or
  translation is shown on another song.
- **Switching modes is instant.** Original / Romanized / Translated switch without a
  reload, from an on-page control, the popup, or a keyboard shortcut.
- **Survives Spotify updates.** Spotify changes its web player often. When something
  the extension depends on changes, the extension must never break playback or
  Spotify's own UI; at worst a feature switches off and the popup says so.
- **Free and private.** No account, no API key, no sign-in, no analytics. Lyrics and
  lines are only sent to the lyrics and translation services that need them.
- **Chrome, Edge and Firefox**, from one codebase, Manifest V3.
- **Preferences follow the user** across devices (mode, target language, the three-line view, the switcher).

## Out of scope

- Spotify's desktop and mobile apps (different platforms; Spicetify covers desktop).
- Editing, submitting or correcting lyrics.
- Getting past any service's bot detection, captchas or sign-in walls.
- Controlling playback beyond what the lyrics view already does (click-to-seek).

## How we will know

- A per-script corpus of real lyric lines with expected romanizations, run in tests.
- Recorded Spotify responses and DOM snapshots, so the page integration is tested
  without a live session; a live smoke test in the test browser before each release.
- Measured on live Spotify: time from song change to processed lyrics, and frames
  where a wrong song's lines are shown (target: zero).
