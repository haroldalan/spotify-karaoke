import { describe, expect, it } from 'vitest';
import { deleteSchwas, romanizeIndic } from '../../src/background/text/indic';
import { romanizeLines } from '../../src/background/text/romanize';
import { lineHas, songScript } from '../../src/shared/scripts';

const noGoogle = { google: async () => null };

describe('script detection', () => {
  it('treats Han as Japanese when the song has kana', () => {
    expect(songScript(['君を愛してる', '永遠'])).toBe('Jpan');
    expect(songScript(['我爱你', '永远'])).toBe('Hani');
    expect(songScript(['永遠'], 'ja')).toBe('Jpan');
  });
  it('picks the main non-Latin script of a mixed song', () => {
    expect(songScript(['사랑해 baby', 'oh yeah', '너만을'])).toBe('Kore');
    expect(songScript(['Hello', 'world'])).toBe('Latn');
  });
  it('knows which lines carry the song script', () => {
    expect(lineHas('oh yeah', 'Kore')).toBe(false);
    expect(lineHas('사랑해 baby', 'Kore')).toBe(true);
    expect(lineHas('永遠', 'Jpan')).toBe(true);
  });
});

describe('Indic romanization', () => {
  const hi = (s: string) => romanizeIndic(s, 'Deva');
  it('drops the unspoken inherent vowel', () => {
    expect(hi('मेरा दिल तेरा है')).toBe('mera dil tera hai');
    expect(hi('समझना')).toBe('samajhna');
    expect(hi('धड़कन')).toBe('dhadkan');
    expect(hi('करना')).toBe('karna');
    expect(hi('अपना')).toBe('apna');
    expect(hi('कमल')).toBe('kamal');
    expect(hi('बचपन')).toBe('bachpan');
    expect(hi('प्यार')).toBe('pyaar');
    expect(hi('ज़िंदगी')).toBe('zindagi');
    expect(hi('ज\u093cिंदगी'.replace('\\u093c', '\u093c'))).toBe('zindagi');
    expect(hi('फिर')).toBe('phir');
    expect(hi('फ़िर')).toBe('fir');
    expect(hi('लड़की')).toBe('ladki');
  });
  it('keeps the inherent vowel in Dravidian languages', () => {
    expect(romanizeIndic('പ്രണയം', 'Mlym')).toBe('pranayam');
    expect(romanizeIndic('ప్రేమ', 'Telu')).toBe('prema');
  });
  it('handles Gurmukhi and Bengali', () => {
    expect(romanizeIndic('ਮੇਰਾ ਦਿਲ', 'Guru')).toBe('mera dil');
    expect(romanizeIndic('আমার সোনার', 'Beng')).toBe('amar sonar');
  });
  it('leaves non-Indic text alone, English words included', () => {
    expect(deleteSchwas('love', 'Deva')).toBe('love');
    expect(hi('दिल baby')).toBe('dil baby');
    expect(hi('चल dance करें')).toBe('chal dance karein');
  });
  it('writes Hindi the way lyrics are written', () => {
    expect(hi('मैं हूँ ना')).toBe('main hoon na'); // ँ is a nasal, not "~"
    expect(hi('ख़याल आता है')).toBe('khayaal aata hai'); // long vowels doubled inside a word
    expect(hi('तेरी मेरी')).toBe('teri meri'); // ...and single at its end
    expect(hi('दिल में बातें')).toBe('dil mein baatein'); // final ें is "ein"
    expect(hi('दूर')).toBe('door');
    expect(hi('हाँ')).toBe('haan');
  });
  it('converts Malayalam final consonants', () => {
    expect(romanizeIndic('ഞാൻ നിന്നെ', 'Mlym')).toBe('njan ninne');
    expect(romanizeIndic('അവൾ', 'Mlym')).toBe('aval');
    expect(romanizeIndic('ഇവർ', 'Mlym')).toBe('ivar');
  });
  it('writes Bengali with b and ng, and short vowels', () => {
    expect(romanizeIndic('ভালোবাসি বাংলা', 'Beng')).toBe('bhalobasi bangla');
    expect(romanizeIndic('আমার সোনার বাংলা', 'Beng')).toBe('amar sonar bangla');
  });
});

describe('romanizeLines', () => {
  it('romanizes Korean, leaves English lines alone', async () => {
    const out = await romanizeLines(['사랑해', 'oh yeah', ''], 'Kore', noGoogle);
    expect(out[0]).toBe('saranghae');
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect((await romanizeLines(['사랑해… 💜 Café'], 'Kore', noGoogle))[0]).toBe('saranghae… 💜 Café');
  });
  it('romanizes Chinese with tone marks', async () => {
    expect((await romanizeLines(['我爱你'], 'Hani', noGoogle))[0]).toBe('wǒ ài nǐ');
  });
  it('romanizes Russian and Ukrainian', async () => {
    expect((await romanizeLines(['Я люблю тебя'], 'Cyrl', noGoogle))[0]).toBe('Ya lyublyu tebya');
    expect((await romanizeLines(['Я тебе кохаю'], 'Cyrl', noGoogle))[0]).toBe('Ya tebe kokhayu');
  });
  it('romanizes Tamil', async () => {
    expect((await romanizeLines(['வணக்கம்'], 'Taml', noGoogle))[0]).toBe('vanakkam');
  });
  it('prefers Google for Arabic, and stays offline for Thai', async () => {
    let asked = 0;
    const google = async (lines: string[]) => { asked++; return lines.map(() => "'uhibuk"); };
    expect((await romanizeLines(['أحبك'], 'Arab', { google }))[0]).toBe("'uhibuk");
    expect((await romanizeLines(['ฉันรักเธอ', 'สบายดีไหม'], 'Thai', { google }))).toEqual(['chan rak thoe', 'sabai di mai']);
    expect(asked).toBe(1);
  });
  it('romanizes each line by its own script in a song with two', async () => {
    const out = await romanizeLines(['사랑해', 'Привет', 'oh yeah'], 'Kore', noGoogle);
    expect(out).toEqual(['saranghae', 'Privet', null]);
  });
  it('falls back to generic transliteration when Google is unavailable', async () => {
    const out = await romanizeLines(['שלום'], 'Hebr', noGoogle);
    expect(out[0]).toMatch(/^[\x20-\x7e]+$/);
  });
});
