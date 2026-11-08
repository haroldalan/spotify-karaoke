/** tamil-romanizer ships no type declarations (lib/lyrics/localRomanizer.ts uses romanize). */
declare module 'tamil-romanizer' {
  export function romanize(text: string, options?: { scheme?: string; [key: string]: unknown }): string;
}
