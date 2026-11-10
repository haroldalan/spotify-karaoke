# Contributing to Spotify Karaoke

Thanks for helping. Issues, ideas and pull requests are all welcome — especially romanization
fixes and support for more scripts.

## Reporting a problem

[Open an issue](https://github.com/haroldalan/spotify-karaoke/issues/new/choose) and pick the
form that fits. The song (its title and artist, or its Spotify link), your browser and the
extension's version (at the bottom of the popup) are what make a problem reproducible.

## Changing the code

Read [PROBLEM.md](PROBLEM.md) (what the extension is for, in priority order) and
[ARCHITECTURE.md](ARCHITECTURE.md) (how it works) first. The rule that matters most: Spotify's
lyrics view is never rebuilt, and nodes React owns are never created, moved or removed.

```bash
npm install
npm run typecheck
npm test
npm run build:devkit   # .output/chrome-mv3-devkit, with the dev kit (docs/devkit.md)
```

Load the build at `chrome://extensions` (Developer mode → Load unpacked) and try your change
in Spotify's web player. [docs/development.md](docs/development.md) covers the dev kit and live
testing in Chrome and Firefox.

- One fix or feature per pull request.
- Add a unit test for what you fix (`tests/unit`). Lyrics in tests are made-up lines or common
  words, never a song's lyrics.
- When romanizer output changes, bump `ROMANIZER_VERSION` in `src/background/text/process.ts`
  and refresh the golden file: `UPDATE_GOLDEN=1 npx vitest run tests/unit/romanizerVersion.test.ts`.

By contributing you agree that your contribution is released under the [MIT licence](LICENSE),
and to follow the [code of conduct](CODE_OF_CONDUCT.md).
