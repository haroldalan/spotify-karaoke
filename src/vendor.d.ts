declare module 'tamil-romanizer' {
  export function romanize(text: string): string;
}
declare module 'cyrillic-to-translit-js' {
  export default class CyrillicToTranslit {
    constructor(options?: { preset?: 'ru' | 'uk' | 'mn' });
    transform(text: string, spaceReplacement?: string): string;
  }
}
