# Privacy Policy — Spotify Karaoke

**Last updated:** November 8, 2026

Spotify Karaoke is an open-source browser extension that fetches missing lyrics, romanizes non-Latin scripts, and translates song lyrics inside Spotify's web player. This policy explains what data the extension accesses, how it is used, and what is shared.

## Data Collection

**Spotify Karaoke does not collect, store, or transmit any personal data.** There is no analytics, no telemetry, no tracking, and no account system.

## Data Stored Locally

The extension stores the following data **locally on your device** using your browser's built-in storage APIs:

| Data | Storage | Purpose |
|:---|:---|:---|
| User preferences (display mode, target language, UI toggles) | `browser.storage.sync` | Syncs your settings across your own devices via your browser account |
| Cached processed lyrics | `browser.storage.local` | Avoids redundant network requests; LRU-evicted at 200 entries |

This data never leaves your device and is not accessible to the extension developer or any third party.

## Network Requests

The extension makes network requests **only** to provide its core functionality. No requests are made in the background when you are not actively using Spotify.

| Service | When | What is sent | Why |
|:---|:---|:---|:---|
| **YouTube Music** (`music.youtube.com`) | When Spotify cannot find lyrics for a song, or shows them romanized | Song title and artist name | To search for synced lyrics |
| **LRCLIB** (`lrclib.net`) | When Spotify cannot find lyrics for a song, or shows them romanized | Song title, artist, album, duration | To search for synced lyrics |
| **Google Translate** (`translate.googleapis.com`) | When you use Translated or certain Romanized modes | Lyric text lines | To translate or romanize lyrics |
| **jsDelivr** (`cdn.jsdelivr.net`) | The first time a Japanese song is romanized | Nothing about you or the song: a public dictionary file is downloaded | Japanese readings for romanization |
| **Spotify's CDNs** (`i.scdn.co`, `open.spotifycdn.com`) | When lyrics are shown for a song Spotify has none for | Nothing new: the artwork and stylesheet addresses already on Spotify's page | To match Spotify's colours and lyrics style |

**No personal identifiers** (IP address, browser fingerprint, Spotify account info, cookies, or authentication tokens) are ever sent to these services by the extension. Only the minimal lyric or song metadata required to fulfill the request is transmitted.

## Permissions

| Permission | Justification |
|:---|:---|
| `storage` / `unlimitedStorage` | Store user preferences and cached lyrics locally |
| `declarativeNetRequest` | Modify request headers for YouTube Music lyrics fetching |
| Host permissions (Spotify, lyrics providers, translation APIs) | Access Spotify's web player and fetch lyrics/translations from the listed services |

## Third-Party Services

The extension does not control the privacy practices of the third-party services listed above. Please refer to their respective privacy policies:

- [Google Privacy Policy](https://policies.google.com/privacy) (Google Translate, YouTube Music)
- [LRCLIB](https://lrclib.net)
- [jsDelivr Privacy Policy](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net)

## Open Source

Spotify Karaoke is fully open source under the MIT License. You can audit the complete source code at [github.com/haroldalan/spotify-karaoke](https://github.com/haroldalan/spotify-karaoke).

## Changes to This Policy

If this policy is updated, the changes will be reflected in this document with an updated date. No retroactive changes will be made to how existing data is handled.

## Contact

If you have questions about this policy, you can reach the developer via [Discord](https://discord.com/users/370486976643727360) or by opening an [issue on GitHub](https://github.com/haroldalan/spotify-karaoke/issues).
