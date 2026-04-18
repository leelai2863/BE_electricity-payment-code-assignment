import type { LogEntry, LogLevel } from '../types';

const LEVEL_RANK: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function shouldDropWhenFull(level: LogLevel, ratio: number): boolean {
  if (ratio <= 0.8) return false;
  if (ratio <= 0.95) return level === 'debug';
  return level === 'debug' || level === 'info';
}

export class LogBuffer {
  private readonly maxSize: number;
  private readonly queue: LogEntry[] = [];

  constructor(maxSize = 50_000) {
    this.maxSize = maxSize;
  }

  get length(): number {
    return this.queue.length;
  }

  enqueue(entry: LogEntry): boolean {
    if (this.queue.length >= this.maxSize) {
      const ratio = this.queue.length / this.maxSize;
      if (shouldDropWhenFull(entry.level, ratio)) {
        return false;
      }
      this.evictLowestPriority();
    }
    this.queue.push(entry);
    return true;
  }

  private evictLowestPriority(): void {
    let worstIdx = 0;
    let worstRank = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const r = LEVEL_RANK[this.queue[i]!.level];
      if (r > worstRank) {
        worstRank = r;
        worstIdx = i;
      }
    }
    if (worstRank >= 0) {
      this.queue.splice(worstIdx, 1);
    }
  }

  dequeueBatch(max: number): LogEntry[] {
    const n = Math.min(max, this.queue.length);
    if (n === 0) return [];
    return this.queue.splice(0, n);
  }

  drainAll(): LogEntry[] {
    const all = this.queue.splice(0, this.queue.length);
    return all;
  }
}
