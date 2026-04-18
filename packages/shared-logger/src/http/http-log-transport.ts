import { Agent, fetch, type Dispatcher } from 'undici';
import type { LogEntry } from '../types';

export interface HttpLogTransportOptions {
  /** Base URL, ví dụ `https://logs.nguyentrungnam.com` (không có path). */
  baseUrl: string;
  /** Bearer token nếu LOG_BRIDGE_INGRESS_SECRET được bật trên bridge. */
  ingressSecret?: string;
  requestTimeoutMs?: number;
}

/**
 * HTTP keep-alive tới Log Bridge; POST `/system-logs` với body `{ entries }`.
 */
export class HttpLogTransport {
  private readonly endpoint: string;
  private readonly healthUrl: string;
  private readonly ingressSecret?: string;
  private readonly timeoutMs: number;
  private readonly dispatcher: Dispatcher;

  constructor(opts: HttpLogTransportOptions) {
    const base = opts.baseUrl.replace(/\/+$/, '');
    this.endpoint = `${base}/system-logs`;
    this.healthUrl = `${base}/health`;
    this.ingressSecret = opts.ingressSecret?.trim() || undefined;
    this.timeoutMs = opts.requestTimeoutMs ?? 15_000;
    this.dispatcher = new Agent({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 120_000,
      connections: 64,
    });
  }

  async sendBatch(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.ingressSecret) {
      headers.Authorization = `Bearer ${this.ingressSecret}`;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entries }),
        dispatcher: this.dispatcher,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 503) {
      throw new Error(`log_bridge_overloaded:${res.status}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`log_bridge_http_${res.status}:${t.slice(0, 200)}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5_000);
      try {
        const res = await fetch(this.healthUrl, {
          method: 'GET',
          dispatcher: this.dispatcher,
          signal: ac.signal,
        });
        return res.ok;
      } finally {
        clearTimeout(t);
      }
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.dispatcher.close();
  }
}
