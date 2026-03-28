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
