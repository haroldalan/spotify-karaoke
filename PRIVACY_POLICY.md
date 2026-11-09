# Privacy Policy: Spotify Karaoke

**Last updated:** November 9, 2026

Spotify Karaoke is an open-source browser extension that romanizes and translates
lyrics in Spotify's web player, finds lyrics Spotify doesn't have, and restores lyrics to
their original script. This page says what it reads, what it stores, and what it sends
where.

## What it does not do

No account, no sign-in, no analytics, no telemetry, no advertising, and nothing is sent
to the developer. The extension never reads, stores or sends your Spotify login, cookies
or access tokens.

## What it reads on open.spotify.com

Inside Spotify's web player the extension reads two kinds of responses Spotify's own page
already receives: track details (title, artists, album, duration, language) and lyrics.
It also reads track details (id, title, artists, album, duration) from Spotify's other
page data, used only when the first kind is missing. It reads the lyrics shown on screen
to draw romanized and translated lines.

## What it stores on your device

| Data | Where | Kept |
|:---|:---|:---|
| Your settings (mode, language, toggles) | `storage.sync`: your browser syncs them across your own devices | Until you change them |
| Lyrics found for songs, romanized and translated lines, songs with no lyrics anywhere | `storage.local` on this device | Up to 2,000 entries, oldest dropped first; entries expire after 30 minutes to 60 days |

Nothing stored is sent anywhere. Removing the extension removes it.

## What it sends, and to whom

The extension sends requests straight from your browser. Like any web request, each one
reveals your IP address to the service that receives it.

| Service | When | What is sent |
|:---|:---|:---|
| **LRCLIB** (`lrclib.net`) | When a song starts (or is queued next) that Spotify has no lyrics for, has only unsynced lyrics for, or shows romanized; before you open the lyrics view, so they are ready | Title, artist, album, duration |
| **YouTube Music** (`music.youtube.com`) | Same as LRCLIB | Title and first artist; then YouTube Music's own ids for the song it found. The extension presents these requests as YouTube Music's Android app, which is the only client YouTube Music gives timed lyrics to |
| **Google Translate** (`translate.googleapis.com`) | When you show translations, and to romanize scripts without a local romanizer (Arabic, Hebrew, Persian, Urdu and others) or Japanese words the local dictionary doesn't know | The lyric lines and your target language |
| **jsDelivr** (`cdn.jsdelivr.net`) | The first time a Japanese song is romanized | Nothing about you or the song: a public dictionary file is downloaded |

## Permissions

| Permission | Why |
|:---|:---|
| `storage`, `unlimitedStorage` | Your settings and the caches above |
| `declarativeNetRequestWithHostAccess` | Sets the request headers YouTube Music expects, on the extension's own background requests to YouTube Music only; never on your tabs or any other site |
| Host access to the services above and open.spotify.com | Run inside Spotify's web player and reach the listed services |

## Third parties

Their own policies apply to what they receive:
[Google](https://policies.google.com/privacy) (Google Translate, YouTube Music),
[LRCLIB](https://lrclib.net), [jsDelivr](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net).

## Source and contact

The source is public under the MIT License at
[github.com/haroldalan/spotify-karaoke](https://github.com/haroldalan/spotify-karaoke).
Questions: open an [issue on GitHub](https://github.com/haroldalan/spotify-karaoke/issues).
Changes to this policy are dated at the top of this page.
