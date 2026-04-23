export type Locale = 'ru' | 'en';

export type DictionaryValue = string | { [key: string]: DictionaryValue };

export type DictionaryTree = Record<string, DictionaryValue>;
