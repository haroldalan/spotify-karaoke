import { describe, expect, it } from 'vitest';
import { deleteSchwas, romanizeIndic } from '../../src/background/text/indic';
import { lineScript, romanizeLines } from '../../src/background/text/romanize';
import { lineHas, songScript, type Script } from '../../src/shared/scripts';

const noGoogle = { google: async () => null };

describe('script detection', () => {
  it('treats Han as Japanese when the song has kana', () => {
    expect(songScript(['君を愛してる', '永遠'])).toBe('Jpan');
    expect(songScript(['我爱你', '永远'])).toBe('Hani');
    expect(songScript(['永遠'], 'ja')).toBe('Jpan');
  });
  it('does not turn a Chinese song into Japanese for a stray kana', () => {
    const zh = ['我爱你永远不变', '在这个世界上只有你', 'の', '明天会更好', '谢谢你', '再见朋友'];
    expect(songScript(zh)).toBe('Hani');
    expect(songScript(zh, 'zh')).toBe('Hani');
    expect(songScript(zh, 'cmn')).toBe('Hani');
    // A real share of kana is Japanese, whatever the tag says; the tag 'ja' always is.
    expect(songScript(['君を愛してる', '永遠に', 'ありがとう'], 'zh')).toBe('Jpan');
    expect(songScript(['永遠', '愛'], 'ja')).toBe('Jpan');
    // And no tag: a few kana among many Han is still Chinese, a Japanese song is not.
    expect(songScript(['東京の街を歩いていた', '君を愛してる'])).toBe('Jpan');
  });
  it('reads a Japanese line in a Chinese song as Japanese', () => {
    expect(lineScript('君を愛してる', 'Hani')).toBe('Jpan');
    expect(lineScript('我爱你', 'Hani')).toBe('Hani');
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
  // Common lyric words, written the way listeners write them. Every one of these must come out
  // as plain ASCII: a letter the converter doesn't know shows as a broken glyph on Spotify.
  it('writes common Hindi and Punjabi lyric words as listeners write them', () => {
    const cases: [string, Script, string][] = [
      ['कुछ', 'Deva', 'kuchh'], ['अच्छा', 'Deva', 'achchha'], ['छुपा', 'Deva', 'chhupa'], ['पीछे', 'Deva', 'peechhe'],
      ['बच्चा', 'Deva', 'bachcha'], ['चाँद', 'Deva', 'chaand'], ['चल', 'Deva', 'chal'], ['सच', 'Deva', 'sach'],
      ['ਸੱਜਣਾ', 'Guru', 'sajjna'], ['ਅੱਜ', 'Guru', 'ajj'], ['ਇੱਕ', 'Guru', 'ikk'], ['ਗੱਲ', 'Guru', 'gall'],
      ['ਪੱਕਾ', 'Guru', 'pakka'], ['ਚੱਕ', 'Guru', 'chakk'], ['ਛੁਪਾ', 'Guru', 'chhupa'], ['ਮੈਨੂੰ', 'Guru', 'mainoon'],
      ['ਮੇਰਾ ਦਿਲ', 'Guru', 'mera dil'], ['આછે', 'Gujr', 'aachhe'],
    ];
    for (const [word, script, want] of cases) {
      const got = romanizeIndic(word, script);
      expect(got, word).toBe(want);
      expect(/^[\x00-\x7f]*$/.test(got), `${word} -> ${got} is ASCII`).toBe(true);
    }
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

// Made-up lines (not lyrics of any song) mixing scripts the way multilingual songs do.
describe('romanization by script run', () => {
  it('cuts a line only where one non-Latin script meets another; Latin stays inside its run', async () => {
    const { scriptRuns } = await import('../../src/background/text/romanize');
    expect(scriptRuns('நான் வந்தேன் चल, तू', 'Taml').map((r) => r.script)).toEqual(['Taml', 'Deva']);
    expect(scriptRuns("Dude'u உன்ன போல yaarum இல்ல", 'Taml')).toEqual([{ text: "Dude'u உன்ன போல yaarum இல்ல", script: 'Taml' }]);
    expect(scriptRuns('君のこと love してる', 'Jpan')).toEqual([{ text: '君のこと love してる', script: 'Jpan' }]);
    expect(scriptRuns('all night long', 'Taml')).toEqual([{ text: 'all night long', script: null }]);
    // Kanji in a Japanese line (kana) is Japanese, even in a Chinese song; otherwise Chinese.
    expect(scriptRuns('君を愛してる', 'Hani')[0].script).toBe('Jpan');
    expect(scriptRuns('我爱你', 'Hani')[0].script).toBe('Hani');
  });

  it('romanizes each script with its own engine in one line: a Devanagari phrase inside a Tamil line', async () => {
    const [out] = await romanizeLines(['நான் வந்தேன் चल, तू'], 'Taml', noGoogle);
    expect(out).toMatch(/^naan vandhaen chal, tu$/);
  });

  it('keeps Latin words as written (an engine that lowercases them is corrected)', async () => {
    const [out] = await romanizeLines(["Dude'u உன்ன போல யாரும் இல்ல"], 'Taml', noGoogle);
    expect(out?.startsWith("Dude'u ")).toBe(true);
  });

  it('a Korean line with English and a Hindi phrase: each part by its own engine', async () => {
    const [out] = await romanizeLines(['너와 나 Forever मेरा दिल'], 'Kore', noGoogle);
    expect(out).toContain('Forever');
    expect(out).toContain('mera dil');
    expect(out).not.toMatch(/[가-힯ऀ-ॿ]/);
  });

  it('sends Google the runs of its scripts in one call per song, whole lines and parts alike', async () => {
    const calls: string[][] = [];
    const google = async (lines: string[]) => { calls.push(lines); return lines.map((l) => `g(${l})`); };
    const out = await romanizeLines(['مرحبا', 'bonjour مرحبا يا'], 'Arab', { google });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['مرحبا', 'bonjour مرحبا يا']);
    expect(out).toEqual(['g(مرحبا)', 'g(bonjour مرحبا يا)']);
  });
});
