export class OutputBuffer {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush = 0;
  private onFlush: (data: string) => void;
  private minMs: number;
  private maxMs: number;
  private maxChars: number;

  constructor(
    onFlush: (data: string) => void,
    minMs = 300,
    maxMs = 800,
    maxChars = 4096
  ) {
    this.onFlush = onFlush;
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.maxChars = maxChars;
  }

  push(data: string): void {
    this.buffer += data;

    // Flush immediately if buffer exceeds max chars
    if (this.buffer.length >= this.maxChars) {
      this.flush();
      return;
    }

    // Schedule flush
    if (!this.timer) {
      const elapsed = Date.now() - this.lastFlush;
      const delay = Math.max(this.minMs, this.minMs - elapsed);
      this.timer = setTimeout(() => this.flush(), delay);

      // Also set a hard max timeout
      setTimeout(() => {
        if (this.buffer.length > 0) this.flush();
      }, this.maxMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;

    const data = this.buffer;
    this.buffer = "";
    this.lastFlush = Date.now();
    this.onFlush(data);
  }

  destroy(): void {
    this.flush();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
