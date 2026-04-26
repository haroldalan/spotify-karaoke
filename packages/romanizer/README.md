# @spotify-karaoke/romanizer

Reusable script detection and local romanization engine extracted from Spotify Karaoke.

## Install

```bash
npm install @spotify-karaoke/romanizer
```

## API

```ts
import {
  createRomanizer,
  detectScript,
  isLatinScript,
  requiresExternalRomanization,
} from '@spotify-karaoke/romanizer';
```

- `detectScript(lines: readonly string[]): ScriptType`
- `isLatinScript(lines: readonly string[]): boolean`
- `requiresExternalRomanization(script: ScriptType): boolean`
- `createRomanizer(options?: { japaneseDictPath?: string }): Romanizer`
- `Romanizer.romanizeLine(line, { script? })`
- `Romanizer.romanizeLines(lines, { script? }): Promise<{ script, lines }>`

## Supported Local Scripts

- `japanese`
- `chinese`
- `korean`
- `cyrillic`
- `devanagari`
- `gujarati`
- `gurmukhi`
- `telugu`
- `kannada`
- `odia`
- `tamil`
- `thai`
- `latin` (no-op)

## External Romanization Scripts

`malayalam`, `bengali`, `arabic`, `hebrew`, and `other` are intentionally marked as external.
Use `requiresExternalRomanization(script)` to branch to API-based romanization.
Calling `romanizeLine/romanizeLines` for these scripts throws `UnsupportedRomanizationError`.
