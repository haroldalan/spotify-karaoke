export type ScriptType =
  | 'japanese'
  | 'chinese'
  | 'korean'
  | 'cyrillic'
  | 'devanagari'
  | 'gujarati'
  | 'gurmukhi'
  | 'telugu'
  | 'kannada'
  | 'odia'
  | 'tamil'
  | 'malayalam'
  | 'bengali'
  | 'arabic'
  | 'hebrew'
  | 'thai'
  | 'latin'
  | 'other';

export type RomanizerOptions = {
  japaneseDictPath?: string;
};

export type RomanizeOptions = {
  script?: ScriptType;
};

export type RomanizeResult = {
  script: ScriptType;
  lines: string[];
};

export interface Romanizer {
  romanizeLine(line: string, options?: RomanizeOptions): Promise<string>;
  romanizeLines(lines: readonly string[], options?: RomanizeOptions): Promise<RomanizeResult>;
}

export class UnsupportedRomanizationError extends Error {
  public readonly script: ScriptType;

  constructor(script: ScriptType) {
    super(`Script '${script}' requires external romanization.`);
    this.name = 'UnsupportedRomanizationError';
    this.script = script;
  }
}
