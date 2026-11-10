# Privacy Policy: Spotify Karaoke

**Last updated:** November 10, 2026

Spotify Karaoke is an open-source browser extension that romanizes and translates
lyrics in Spotify's web player, finds lyrics Spotify doesn't have, and restores lyrics to
their original script. This page says what it reads, what it stores, and what it sends
where.

These lookups are always on: they are what the extension is for, so installing it is
the choice to use them. There is no setting to turn them off; remove the extension to stop
them.

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
| Your settings (mode, language, switches), and the songs you chose "Not this song" for (Spotify ids, up to 250) | `storage.sync`: your browser syncs them across your own devices | Until you change them or press Reset data |
| Lyrics found for songs, romanized and translated lines, songs with no lyrics anywhere | `storage.local` on this device | Up to 2,000 entries, oldest dropped first; entries expire after 30 minutes to 60 days |

Nothing stored is sent anywhere. Clear cache and Reset data in the popup remove it; so does
removing the extension.

## What it sends, and to whom

The extension sends requests straight from your browser. Like any web request, each one
reveals your IP address to the service that receives it.

| Service | When | What is sent |
|:---|:---|:---|
| **LRCLIB** (`lrclib.net`) | When a song starts (or is queued next) that Spotify has no lyrics for, has only unsynced lyrics for, or shows romanized; before you open the lyrics view, so they are ready | Title, artist, album, duration |
| **YouTube Music** (`music.youtube.com`) | Same as LRCLIB | Title and first artist; then YouTube Music's own ids for the song it found. The extension presents these requests as YouTube Music's Android app, which is the only client YouTube Music gives timed lyrics to. Once a day it also reads YouTube Music's public home page (nothing is sent but the request) for the version number its web client uses |
| **Google Translate** (`translate.googleapis.com`) | When you show translations, and to romanize scripts without a local romanizer (Arabic, Hebrew, Persian, Urdu and others) or Japanese lines with a word the local dictionary doesn't know. Also, in any mode, when Spotify shows a song in those scripts romanized and the extension checks a copy in the song's own script against it | The lyric lines (the whole song, in one request) and your target language. The extension presents these requests as Google Translate's Android app |
| **Google Translate, website widget** (`translate-pa.googleapis.com`, and its script on `translate.googleapis.com`) | Only while Google Translate above asks the extension to slow down: the backup for translations | The lyric lines and your target language. The widget's public key is read from Google's widget script, which sends nothing about you or the song |
| **LRCLIB uploader** (`lrclibup.boidu.dev`, a community tool for adding lyrics to LRCLIB) | Only when you click "Add lyrics to LRCLIB" on a song no source has lyrics for: a new tab opens at its address. The extension itself sends nothing to it | Title, artist, album and duration, in the address of the tab that opens |
| **jsDelivr** (`cdn.jsdelivr.net`) | When a Japanese song starts or is queued while romanization is wanted (Romanized mode, or All three lines): the dictionary (about 18 MB) is downloaded, then kept by the browser. Original mode downloads nothing | Nothing about you or the song: a public dictionary file is downloaded |

## Permissions

| Permission | Why |
|:---|:---|
| `storage`, `unlimitedStorage` | Your settings and the caches above |
| `scripting` | When the extension is installed or updated, adds it to Spotify tabs that are already open, so they work without a reload |
| `declarativeNetRequestWithHostAccess` | Sets the request headers of the YouTube Music and Google Translate Android apps the extension presents itself as, and leaves out the extension's Origin and Referer (which would identify the extension) on requests to YouTube Music, Google Translate and LRCLIB, on the extension's own background requests only; never on your tabs or any other site |
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
