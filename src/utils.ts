export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel(): void;
}

/** Detect whether input looks like an absolute file system path. */
export function isAbsolutePath(input: string): boolean {
  // Windows: drive letter + :\ or :/
  if (/^[a-zA-Z]:[/\\]/.test(input)) return true;
  // Unix/macOS: starts with / followed by a non-whitespace char
  if (/^\/\S/.test(input)) return true;
  return false;
}

import { ResultSection, DEFAULT_SECTIONS } from './providers/types';

const VALID_SECTIONS = new Set<string>(Object.values(ResultSection));

export function getEnabledSections(raw: unknown): ResultSection[] {
  if (!Array.isArray(raw)) return DEFAULT_SECTIONS;

  const seen = new Set<string>();
  const sections: ResultSection[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!VALID_SECTIONS.has(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    sections.push(item as ResultSection);
  }
  return sections;
}

import type { SearchOptions } from './providers/types';

const WORD_CHAR_RE = /[A-Za-z0-9_]/;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR_RE.test(char);
}

/**
 * Whole-word containment matching ripgrep's `\b` semantics: alphanumerics and
 * underscores are word characters, so "path" is not a whole word in
 * "test_path" but is one in "src/path" or "path.cpp". Boundary checks are
 * skipped on sides where the query itself starts/ends with a non-word
 * character (matching how `\b` behaves there).
 */
export function containsWholeWord(text: string, query: string, caseSensitive: boolean): boolean {
  if (query.length === 0) return true;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const needsStartBoundary = isWordChar(needle[0]);
  const needsEndBoundary = isWordChar(needle[needle.length - 1]);

  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const startOk = !needsStartBoundary || !isWordChar(haystack[index - 1]);
    const endOk = !needsEndBoundary || !isWordChar(haystack[index + needle.length]);
    if (startOk && endOk) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

/**
 * True when `query` appears in `text` as a case-sensitive subsequence.
 * Used to constrain fuzzy-matched results when the match-case toggle is on.
 */
export function hasCaseSensitiveSubsequence(text: string, query: string): boolean {
  let queryIndex = 0;
  for (let i = 0; i < text.length && queryIndex < query.length; i++) {
    if (text[i] === query[queryIndex]) queryIndex++;
  }
  return queryIndex === query.length;
}

/** Substring containment honoring the match-case and whole-word toggles. */
export function containsQuery(
  text: string,
  query: string,
  options: Pick<SearchOptions, 'caseSensitive' | 'matchWholeWord'>,
): boolean {
  if (options.matchWholeWord) return containsWholeWord(text, query, options.caseSensitive);
  if (options.caseSensitive) return text.includes(query);
  return text.toLowerCase().includes(query.toLowerCase());
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as Debounced<Args>;
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return debounced;
}
