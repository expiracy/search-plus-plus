import type { Disposable } from 'vscode';

/** Owns all work for the current input, including work that has not started yet. */
export class SearchSession<T> implements Disposable {
  private version = 0;
  private active?: Disposable;
  private timer?: ReturnType<typeof setTimeout>;

  run(
    start: (publish: (results: T) => void, fail: (error: unknown) => void) => Disposable | void,
    publish: (results: T) => void,
    fail: (error: unknown) => void,
    delayMs = 0,
  ): void {
    this.cancel();
    const version = this.version;
    const current = () => version === this.version;
    const run = () => {
      this.timer = undefined;
      if (!current()) return;
      try {
        const request = start(
          results => { if (current()) publish(results); },
          error => { if (current()) fail(error); },
        );
        if (current()) this.active = request || undefined;
        else request?.dispose();
      } catch (error) {
        if (current()) fail(error);
      }
    };
    if (delayMs > 0) this.timer = setTimeout(run, delayMs);
    else run();
  }

  cancel(): void {
    this.version++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const active = this.active;
    this.active = undefined;
    active?.dispose();
  }

  dispose(): void { this.cancel(); }
}
