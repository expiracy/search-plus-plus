export interface Debounced<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

/** Detect whether input looks like an absolute file system path. */
export function isAbsolutePath(input: string): boolean {
  // Windows: drive letter + :\ or :/
  if (/^[a-zA-Z]:[\\\/]/.test(input)) return true;
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

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number,
): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as Debounced<T>;
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return debounced;
}
