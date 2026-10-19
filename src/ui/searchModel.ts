import type { IndexState } from '../index/indexManager';

/** Prepend an indexing indicator to the title when the file index is still building. */
export function buildTitle(baseTitle: string, state: IndexState): string {
  return state === 'building' ? `Indexing... | ${baseTitle}` : baseTitle;
}

/** Parse :line:col suffix from query (only used on Files tab) */
export function parseLineCol(value: string): { query: string; gotoLine?: number; gotoColumn?: number } {
  const parts = value.split(':');
  if (parts.length >= 3) {
    const col = parsePositionPart(parts[parts.length - 1]);
    const line = parsePositionPart(parts[parts.length - 2]);
    if (line >= 1 && parts[parts.length - 1] === '') {
      return { query: parts.slice(0, -2).join(':'), gotoLine: line };
    }
    if (!isNaN(line) && line >= 1 && !isNaN(col) && col >= 0) {
      return { query: parts.slice(0, -2).join(':'), gotoLine: line, gotoColumn: col };
    }
  }
  if (parts.length >= 2) {
    const line = parsePositionPart(parts[parts.length - 1]);
    if (!isNaN(line) && line >= 1) {
      return { query: parts.slice(0, -1).join(':'), gotoLine: line };
    }
  }
  return { query: value };
}


function parsePositionPart(value: string): number {
  const number = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(number) ? number : NaN;
}
