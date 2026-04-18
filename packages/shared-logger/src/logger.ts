import { hostname } from 'node:os';
import type { LogAuditPayload, LogEntry, LogLevel, SharedLoggerOptions } from './types';
import { getLogContext } from './context';
import { LogBuffer } from './amqp/log-buffer';
import { HttpLogTransport } from './http/http-log-transport';
import { compactLogEntryForTransport } from './compact-entry';

const STDOUT_CHUNK = 200;

function fallbackStdoutLine(entry: LogEntry): void {
  try {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  } catch {
    /* ignore */
  }
}

export class SharedLogger {
  private readonly serviceName: string;
  private readonly serviceKey: string;
  private readonly environment: string;
  private readonly host: string;
  private readonly buffer: LogBuffer;
  private readonly httpTransport: HttpLogTransport | null = null;
  private readonly batchMaxEntries: number;
  private readonly batchFlushMs: number;
  private httpBatchTimer: NodeJS.Timeout | null = null;
  private stdoutDrainScheduled = false;
  private shuttingDown = false;

  constructor(opts: SharedLoggerOptions) {
    this.serviceName = opts.serviceName;
    this.serviceKey = opts.serviceKey;
    this.environment = opts.NODE_ENV ?? process.env.NODE_ENV ?? 'development';
    this.host = hostname();
    this.buffer = new LogBuffer(opts.maxBufferSize ?? 50_000);
    this.batchMaxEntries = Math.max(1, Math.min(500, opts.batchMaxEntries ?? 10));
    this.batchFlushMs = Math.max(100, opts.batchFlushMs ?? 2_000);

    const bridge = opts.logBridgeUrl?.trim();
    if (bridge) {
      const secret = (opts.logBridgeIngressSecret ?? process.env.LOG_BRIDGE_INGRESS_SECRET)?.trim();
      if (bridge.startsWith('https:') && !secret) {
        console.warn(
          '[shared-logger] LOG_BRIDGE_URL is HTTPS but LOG_BRIDGE_INGRESS_SECRET is empty; POST /system-logs may return 401.',
        );
      }
      this.httpTransport = new HttpLogTransport({
        baseUrl: bridge,
        ingressSecret: secret || undefined,
        requestTimeoutMs: opts.httpRequestTimeoutMs ?? 15_000,
      });
    }
  }

  private clearHttpTimer(): void {
    if (this.httpBatchTimer) {
      clearTimeout(this.httpBatchTimer);
      this.httpBatchTimer = null;
    }
  }

  private ensureHttpFlushTimer(): void {
    if (this.httpBatchTimer || !this.httpTransport || this.shuttingDown) return;
    this.httpBatchTimer = setTimeout(() => {
      this.httpBatchTimer = null;
      void this.flushHttpNow();
    }, this.batchFlushMs);
  }

  /**
   * Gửi tối đa `batchMaxEntries`; lặp nếu backlog lớn; hẹn timer cho phần còn lại.
   */
  private async flushHttpNow(): Promise<void> {
    this.clearHttpTimer();
    if (!this.httpTransport || this.shuttingDown) return;

    while (this.buffer.length >= this.batchMaxEntries) {
      const batch = this.buffer.dequeueBatch(this.batchMaxEntries);
      if (batch.length === 0) break;
      try {
        await this.httpTransport.sendBatch(batch);
      } catch {
        for (const e of batch) fallbackStdoutLine(e);
      }
    }

    if (this.buffer.length > 0 && !this.shuttingDown) {
      const batch = this.buffer.dequeueBatch(this.batchMaxEntries);
      if (batch.length > 0) {
        try {
          await this.httpTransport.sendBatch(batch);
        } catch {
          for (const e of batch) fallbackStdoutLine(e);
        }
      }
      if (this.buffer.length > 0) {
        this.ensureHttpFlushTimer();
      }
    }
  }

  private scheduleHttpPipeline(): void {
    if (!this.httpTransport || this.shuttingDown) return;
    if (this.buffer.length >= this.batchMaxEntries) {
      void this.flushHttpNow();
      return;
    }
    this.ensureHttpFlushTimer();
  }

  private scheduleStdoutDrain(): void {
    if (this.stdoutDrainScheduled || this.shuttingDown) return;
    this.stdoutDrainScheduled = true;
    setImmediate(() => {
      this.stdoutDrainScheduled = false;
      const batch = this.buffer.dequeueBatch(STDOUT_CHUNK);
      for (const entry of batch) {
        fallbackStdoutLine(entry);
      }
      if (this.buffer.length > 0) {
        this.scheduleStdoutDrain();
      }
    });
  }

  private buildBase(level: LogLevel, message: string, fields?: Partial<LogEntry>): LogEntry {
    const ctx = getLogContext();
    const traceId = fields?.traceId ?? ctx?.traceId ?? 'no-trace';
    const service = fields?.service ?? ctx?.serviceName ?? this.serviceName;
    const serviceKey = fields?.serviceKey ?? ctx?.serviceKey ?? this.serviceKey;

    const base: LogEntry = {
      traceId,
      timestamp: fields?.timestamp ?? new Date().toISOString(),
      level,
      message,
      service,
      serviceKey,
      environment: fields?.environment ?? this.environment,
      hostname: fields?.hostname ?? this.host,
    };

    return {
      ...base,
      ...fields,
      traceId,
      service,
      serviceKey,
      level,
      message,
    };
  }

  log(level: LogLevel, message: string, fields?: Partial<LogEntry>): void {
    const entry = compactLogEntryForTransport(this.buildBase(level, message, fields));
    this.buffer.enqueue(entry);
    if (this.httpTransport) {
      this.scheduleHttpPipeline();
    } else {
      this.scheduleStdoutDrain();
    }
  }

  debug(message: string, fields?: Partial<LogEntry>): void {
    this.log('debug', message, fields);
  }

  info(message: string, fields?: Partial<LogEntry>): void {
    this.log('info', message, fields);
  }

  warn(message: string, fields?: Partial<LogEntry>): void {
    this.log('warn', message, fields);
  }

  error(message: string, fields?: Partial<LogEntry>): void {
    this.log('error', message, fields);
  }

  fatal(message: string, fields?: Partial<LogEntry>): void {
    this.log('fatal', message, fields);
  }

  /**
   * Nhật ký thao tác nghiệp vụ (user / service account), không phải access log.
   * Luôn `level: info` + `logType: audit`; bắt buộc `audit.action`.
   */
  audit(message: string, fields: Partial<LogEntry> & { audit: LogAuditPayload }): void {
    const { level: _ignoreLevel, logType: _ignoreLt, ...rest } = fields;
    void _ignoreLevel;
    void _ignoreLt;
    this.log('info', message, { ...rest, logType: 'audit' });
  }

  /**
   * Chờ Log Bridge `/health` (khi `logBridgeUrl` được cấu hình).
   */
  async waitUntilLogBridgeReady(timeoutMs = 15_000): Promise<boolean> {
    if (!this.httpTransport) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.httpTransport.healthCheck()) return true;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  /** @deprecated Dùng waitUntilLogBridgeReady */
  async waitUntilPublisherReady(timeoutMs = 15_000): Promise<boolean> {
    return this.waitUntilLogBridgeReady(timeoutMs);
  }

  async shutdown(timeoutMs = 5_000): Promise<void> {
    this.shuttingDown = true;
    this.clearHttpTimer();

    const deadline = Date.now() + timeoutMs;

    if (this.httpTransport) {
      while (this.buffer.length > 0 && Date.now() < deadline) {
        const batch = this.buffer.dequeueBatch(this.batchMaxEntries);
        if (batch.length === 0) break;
        try {
          await this.httpTransport.sendBatch(batch);
        } catch {
          for (const e of batch) fallbackStdoutLine(e);
        }
      }
      const rest = this.buffer.drainAll();
      if (rest.length > 0) {
        try {
          await this.httpTransport.sendBatch(rest);
        } catch {
          for (const e of rest) fallbackStdoutLine(e);
        }
      }
      await this.httpTransport.close();
    } else {
      const rest = this.buffer.drainAll();
      for (const e of rest) {
        fallbackStdoutLine(e);
      }
    }
  }
}

let singleton: SharedLogger | null = null;

export function createSharedLogger(opts: SharedLoggerOptions): SharedLogger {
  singleton = new SharedLogger(opts);
  return singleton;
}

export function getSharedLogger(): SharedLogger | null {
  return singleton;
}

/** Chờ Log Bridge sẵn sàng (hoặc no-op nếu không cấu hình URL). */
export async function waitForLogBridgeReady(
  logBridgeUrl: string | undefined,
  timeoutMs = 15_000,
): Promise<void> {
  const url = logBridgeUrl?.trim();
  if (!url) return;
  const logger = getSharedLogger();
  const ok = await logger?.waitUntilLogBridgeReady(timeoutMs);
  if (!ok) {
    console.warn(
      `[shared-logger] Log Bridge not ready within ${timeoutMs}ms; entries may use stdout until reachable`,
    );
  }
}

/** @deprecated Dùng waitForLogBridgeReady — tham số là Log Bridge base URL. */
export async function waitForSharedLoggerBroker(
  logBridgeUrl: string | undefined,
  timeoutMs?: number,
): Promise<void> {
  return waitForLogBridgeReady(logBridgeUrl, timeoutMs);
}
