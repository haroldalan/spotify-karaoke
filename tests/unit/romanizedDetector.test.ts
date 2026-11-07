import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  detectRomanizedLanguage,
  isLikelyRomanizedFallback,
  nonLatinLetterRatio,
} from '../../lib/lyrics/romanizedDetector';

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/color-lyrics-romanized-hindi.json'), 'utf8'),
);
const fixtureLines: string[] = fixture.lyrics.lines.map((l: { words: string }) => l.words);

// All lines below are invented for testing; none are song lyrics.
const ENGLISH = [
  'I walked along the river when the night was cold',
  'You told me that the morning always comes again',
  'We could run until the city lights are gone',
  'Hold on, the story is not over yet',
  'Every road I take still leads me back to you',
];
const INDONESIAN = [
  'Aku ingin selalu ada di sampingmu',
  'Kamu adalah cahaya dalam hidupku',
  'Jangan pergi meninggalkan hati ini',
  'Rindu ini tak pernah hilang',
  'Bersama kita lewati semua hari',
];
const SPANISH = [
  'Quiero amar tu sonrisa cada mañana',
  'No puedo tomar otra decisión sin ti',
  'Bailamos bajo la luna toda la noche',
  'Mi corazón te busca en cada calle',
];
const FRENCH = [
  'Mon ami, je pense à toi tous les jours',
  'Nous marchons ensemble sous la pluie',
  'Un jour en été, le ciel était bleu',
  'Elle chante encore pour son amour perdu',
];
const ROMANIZED_TAMIL = [
  'Naan unnai paarthu sirithen',
  'En nenjam unnoda thaan irukku',
  'Kadhal oru kanavu pola',
  'Nee illai endraal naan illai',
  'Anbe vaa en uyire',
];
const ROMAJI = [
  'Kimi no koe ga kikoeru yo',
  'Boku wa itsumo koko ni iru',
  'Ashita no sora wo miagete',
  'Kokoro no naka de zutto yume wo miteru',
];

describe('romanizedDetector', () => {
  it('detects romanized Hindi from vocabulary even when Spotify tags it "id"', () => {
    const v = isLikelyRomanizedFallback(fixtureLines, fixture.lyrics.language);
    expect(v).toEqual({ romanized: true, lang: 'hi', reason: 'vocabulary' });
  });

  it('trusts a non-Latin language tag on Latin text', () => {
    expect(isLikelyRomanizedFallback(fixtureLines, 'hi-IN')).toEqual({ romanized: true, lang: 'hi', reason: 'tag' });
  });

  it('never flags lyrics that are already in native script', () => {
    const devanagari = ['मेरा दिल तेरा है', 'तुम कहाँ हो यार', 'फिर भी मुझे प्यार है', 'ज़िंदगी के हर सफ़र में'];
    const cyrillic = ['Я иду по улице одна', 'Ты не звонишь мне давно', 'Ночью город спит', 'Всё будет хорошо'];
    expect(isLikelyRomanizedFallback(devanagari, 'hi').reason).toBe('native-script');
    expect(isLikelyRomanizedFallback(cyrillic, 'ru').reason).toBe('native-script');
    expect(isLikelyRomanizedFallback(cyrillic, 'id').romanized).toBe(false);
  });

  it('treats native lyrics mixed with many English lines as native, even with a ko/ja tag', () => {
    const mixedKo = [
      '오늘 밤 너와 함께', 'I just wanna dance with you tonight', '내 맘을 몰라', 'Baby, take my hand and never let go',
      '하늘 위로', 'We can fly so high above the city lights', '너만 보여', 'Every single moment feels so right',
    ];
    const mixedJa = [
      '君と見た空', 'Running through the summer rain again', '忘れないで', 'Hold me close until the morning comes',
      '夢の中で', 'I can hear you calling out my name', '会いたい', 'Never gonna let this feeling fade',
    ];
    expect(nonLatinLetterRatio(mixedKo)).toBeLessThan(0.3);
    expect(isLikelyRomanizedFallback(mixedKo, 'ko')).toEqual({ romanized: false, lang: null, reason: 'native-script' });
    expect(isLikelyRomanizedFallback(mixedJa, 'ja')).toEqual({ romanized: false, lang: null, reason: 'native-script' });
  });

  it.each([
    ['English', ENGLISH, 'en'],
    ['Indonesian', INDONESIAN, 'id'],
    ['Spanish', SPANISH, 'es'],
    ['French', FRENCH, 'fr'],
  ])('does not flag genuine %s lyrics', (_name, lines, tag) => {
    expect(isLikelyRomanizedFallback(lines, tag).romanized).toBe(false);
    expect(isLikelyRomanizedFallback(lines, 'id').romanized).toBe(false);
    expect(detectRomanizedLanguage(lines).lang).toBeNull();
  });

  it('detects romanized Tamil and Japanese romaji', () => {
    expect(detectRomanizedLanguage(ROMANIZED_TAMIL).lang).toBe('ta');
    expect(detectRomanizedLanguage(ROMAJI).lang).toBe('ja');
  });

  it('does not decide on very short text', () => {
    expect(isLikelyRomanizedFallback(['Mera dil'], 'id').reason).toBe('too-short');
  });

  it('measures the non-Latin letter share', () => {
    expect(nonLatinLetterRatio(['abc'])).toBe(0);
    expect(nonLatinLetterRatio(['한국'])).toBe(1);
    expect(nonLatinLetterRatio(['♪ 123'])).toBe(0);
  });
});
