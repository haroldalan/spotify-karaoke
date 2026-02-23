declare module 'cyrillic-to-translit-js' {
  interface CyrillicToTranslit {
    transform(input: string): string;
    reverse(input: string): string;
  }
  interface Options {
    preset?: 'ru' | 'uk';
  }
  function CyrillicToTranslit(options?: Options): CyrillicToTranslit;
  export = CyrillicToTranslit;
}
