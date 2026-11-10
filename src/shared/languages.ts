/** Target languages Google Translate supports: [code, English name]. */
export const LANGUAGES: [string, string][] = [
  ['af', 'Afrikaans'], ['sq', 'Albanian'], ['am', 'Amharic'], ['ar', 'Arabic'], ['hy', 'Armenian'], ['as', 'Assamese'],
  ['ay', 'Aymara'], ['az', 'Azerbaijani'], ['bm', 'Bambara'], ['eu', 'Basque'], ['be', 'Belarusian'], ['bn', 'Bengali'],
  ['bho', 'Bhojpuri'], ['bs', 'Bosnian'], ['bg', 'Bulgarian'], ['ca', 'Catalan'], ['ceb', 'Cebuano'], ['zh-CN', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)'], ['co', 'Corsican'], ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['dv', 'Dhivehi'],
  ['doi', 'Dogri'], ['nl', 'Dutch'], ['en', 'English'], ['eo', 'Esperanto'], ['et', 'Estonian'], ['ee', 'Ewe'], ['fil', 'Filipino'],
  ['fi', 'Finnish'], ['fr', 'French'], ['fy', 'Frisian'], ['gl', 'Galician'], ['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'],
  ['gn', 'Guarani'], ['gu', 'Gujarati'], ['ht', 'Haitian Creole'], ['ha', 'Hausa'], ['haw', 'Hawaiian'], ['iw', 'Hebrew'], ['hi', 'Hindi'],
  ['hmn', 'Hmong'], ['hu', 'Hungarian'], ['is', 'Icelandic'], ['ig', 'Igbo'], ['ilo', 'Ilocano'], ['id', 'Indonesian'], ['ga', 'Irish'],
  ['it', 'Italian'], ['ja', 'Japanese'], ['jw', 'Javanese'], ['kn', 'Kannada'], ['kk', 'Kazakh'], ['km', 'Khmer'], ['rw', 'Kinyarwanda'],
  ['gom', 'Konkani'], ['ko', 'Korean'], ['kri', 'Krio'], ['ku', 'Kurdish (Kurmanji)'], ['ckb', 'Kurdish (Sorani)'], ['ky', 'Kyrgyz'],
  ['lo', 'Lao'], ['la', 'Latin'], ['lv', 'Latvian'], ['ln', 'Lingala'], ['lt', 'Lithuanian'], ['lg', 'Luganda'], ['lb', 'Luxembourgish'],
  ['mk', 'Macedonian'], ['mai', 'Maithili'], ['mg', 'Malagasy'], ['ms', 'Malay'], ['ml', 'Malayalam'], ['mt', 'Maltese'], ['mi', 'Maori'],
  ['mr', 'Marathi'], ['mni-Mtei', 'Meiteilon (Manipuri)'], ['lus', 'Mizo'], ['mn', 'Mongolian'], ['my', 'Myanmar (Burmese)'], ['ne', 'Nepali'],
  ['no', 'Norwegian'], ['ny', 'Nyanja (Chichewa)'], ['or', 'Odia (Oriya)'], ['om', 'Oromo'], ['ps', 'Pashto'], ['fa', 'Persian'],
  ['pl', 'Polish'], ['pt', 'Portuguese'], ['pa', 'Punjabi'], ['qu', 'Quechua'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sm', 'Samoan'],
  ['sa', 'Sanskrit'], ['gd', 'Scots Gaelic'], ['nso', 'Sepedi'], ['sr', 'Serbian'], ['st', 'Sesotho'], ['sn', 'Shona'], ['sd', 'Sindhi'],
  ['si', 'Sinhala'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['so', 'Somali'], ['es', 'Spanish'], ['su', 'Sundanese'], ['sw', 'Swahili'],
  ['sv', 'Swedish'], ['tl', 'Tagalog'], ['tg', 'Tajik'], ['ta', 'Tamil'], ['tt', 'Tatar'], ['te', 'Telugu'], ['th', 'Thai'], ['ti', 'Tigrinya'],
  ['ts', 'Tsonga'], ['tr', 'Turkish'], ['tk', 'Turkmen'], ['ak', 'Twi'], ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['ug', 'Uyghur'], ['uz', 'Uzbek'],
  ['vi', 'Vietnamese'], ['cy', 'Welsh'], ['xh', 'Xhosa'], ['yi', 'Yiddish'], ['yo', 'Yoruba'], ['zu', 'Zulu'],
];

/**
 * Names that start with what was typed come first, then names with a word that does, then
 * the rest: "hin" finds Hindi before Chinese. The order is otherwise kept.
 */
export function rankByQuery<T extends [string, string]>(langs: T[], query: string): T[] {
  if (!query) return langs;
  const rank = ([code, name]: T) => {
    const n = name.toLowerCase();
    if (code.toLowerCase() === query || n.startsWith(query)) return 0;
    return n.split(/[\s(),-]+/).some((w) => w.startsWith(query)) ? 1 : 2;
  };
  return langs.map((l, i) => [l, i] as const).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([l]) => l);
}
