export interface Debounced<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel(): void;
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
