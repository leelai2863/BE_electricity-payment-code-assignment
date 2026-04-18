import { AsyncLocalStorage } from 'async_hooks';
import { hostname } from 'os';
import { Agent, fetch } from 'undici';

// src/context.ts
var storage = new AsyncLocalStorage();
function runWithLogContext(ctx, fn) {
  return storage.run(ctx, fn);
}
function enterLogContext(ctx) {
  storage.enterWith(ctx);
}
function getLogContext() {
  return storage.getStore();
}
function getTraceIdOrFallback(fallback) {
  return storage.getStore()?.traceId ?? fallback;
}

// src/amqp/log-buffer.ts
var LEVEL_RANK = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};
function shouldDropWhenFull(level, ratio) {
  if (ratio <= 0.8) return false;
  if (ratio <= 0.95) return level === "debug";
  return level === "debug" || level === "info";
}
var LogBuffer = class {
  maxSize;
  queue = [];
  constructor(maxSize = 5e4) {
    this.maxSize = maxSize;
  }
  get length() {
    return this.queue.length;
  }
  enqueue(entry) {
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
  evictLowestPriority() {
    let worstIdx = 0;
    let worstRank = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const r = LEVEL_RANK[this.queue[i].level];
      if (r > worstRank) {
        worstRank = r;
        worstIdx = i;
      }
    }
    if (worstRank >= 0) {
      this.queue.splice(worstIdx, 1);
    }
  }
  dequeueBatch(max) {
    const n = Math.min(max, this.queue.length);
    if (n === 0) return [];
    return this.queue.splice(0, n);
  }
  drainAll() {
    const all = this.queue.splice(0, this.queue.length);
    return all;
  }
};
var HttpLogTransport = class {
  endpoint;
  healthUrl;
  ingressSecret;
  timeoutMs;
  dispatcher;
  constructor(opts) {
    const base = opts.baseUrl.replace(/\/+$/, "");
    this.endpoint = `${base}/system-logs`;
    this.healthUrl = `${base}/health`;
    this.ingressSecret = opts.ingressSecret?.trim() || void 0;
    this.timeoutMs = opts.requestTimeoutMs ?? 15e3;
    this.dispatcher = new Agent({
      keepAliveTimeout: 6e4,
      keepAliveMaxTimeout: 12e4,
      connections: 64
    });
  }
  async sendBatch(entries) {
    if (entries.length === 0) return;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (this.ingressSecret) {
      headers.Authorization = `Bearer ${this.ingressSecret}`;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ entries }),
        dispatcher: this.dispatcher,
        signal: ac.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 503) {
      throw new Error(`log_bridge_overloaded:${res.status}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`log_bridge_http_${res.status}:${t.slice(0, 200)}`);
    }
  }
  async healthCheck() {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5e3);
      try {
        const res = await fetch(this.healthUrl, {
          method: "GET",
          dispatcher: this.dispatcher,
          signal: ac.signal
        });
        return res.ok;
      } finally {
        clearTimeout(t);
      }
    } catch {
      return false;
    }
  }
  async close() {
    await this.dispatcher.close();
  }
};

// src/compact-entry.ts
var DEFAULT_MAX_USER_AGENT = 256;
var DEFAULT_MAX_STACK = 6e3;
var DEFAULT_MAX_METADATA_KEYS = 32;
var DEFAULT_MAX_AUDIT_SUMMARY = 2e3;
var DEFAULT_MAX_AUDIT_DETAILS_KEYS = 24;
function stripUndefined(obj) {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === void 0) delete out[k];
  }
  return out;
}
function compactLogEntryForTransport(entry, opts) {
  const maxUa = opts?.maxUserAgent ?? DEFAULT_MAX_USER_AGENT;
  const maxStack = opts?.maxStack ?? DEFAULT_MAX_STACK;
  const maxMetaKeys = opts?.maxMetadataKeys ?? DEFAULT_MAX_METADATA_KEYS;
  let next = { ...entry };
  if (next.userAgent && next.userAgent.length > maxUa) {
    next = { ...next, userAgent: `${next.userAgent.slice(0, maxUa)}\u2026` };
  }
  if (next.error?.stack && next.error.stack.length > maxStack) {
    next = {
      ...next,
      error: { ...next.error, stack: `${next.error.stack.slice(0, maxStack)}
\u2026(truncated)` }
    };
  }
  if (next.metadata && typeof next.metadata === "object" && !Array.isArray(next.metadata)) {
    const entries = Object.entries(next.metadata).filter(([, v]) => v !== void 0);
    const sliced = entries.slice(0, maxMetaKeys);
    const meta = Object.fromEntries(sliced);
    if (Object.keys(meta).length === 0) {
      const { metadata: _omit, ...rest } = next;
      next = rest;
    } else {
      next = { ...next, metadata: meta };
    }
  }
  if (next.audit && typeof next.audit === "object") {
    const a = next.audit;
    const summary = a.summary && a.summary.length > DEFAULT_MAX_AUDIT_SUMMARY ? `${a.summary.slice(0, DEFAULT_MAX_AUDIT_SUMMARY)}\u2026` : a.summary;
    let details = a.details;
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const entries = Object.entries(details).filter(([, v]) => v !== void 0);
      const sliced = entries.slice(0, DEFAULT_MAX_AUDIT_DETAILS_KEYS);
      details = Object.fromEntries(sliced);
    }
    const compactAudit = { action: a.action };
    if (a.module !== void 0) compactAudit.module = a.module;
    if (a.resourceType !== void 0) compactAudit.resourceType = a.resourceType;
    if (a.resourceId !== void 0) compactAudit.resourceId = a.resourceId;
    if (a.outcome !== void 0) compactAudit.outcome = a.outcome;
    if (a.actorType !== void 0) compactAudit.actorType = a.actorType;
    if (summary !== void 0) compactAudit.summary = summary;
    if (details !== void 0) compactAudit.details = details;
    next = { ...next, audit: compactAudit };
  }
  return stripUndefined(next);
}

// src/logger.ts
var STDOUT_CHUNK = 200;
function fallbackStdoutLine(entry) {
  try {
    process.stdout.write(`${JSON.stringify(entry)}
`);
  } catch {
  }
}
var SharedLogger = class {
  serviceName;
  serviceKey;
  environment;
  host;
  buffer;
  httpTransport = null;
  batchMaxEntries;
  batchFlushMs;
  httpBatchTimer = null;
  stdoutDrainScheduled = false;
  shuttingDown = false;
  constructor(opts) {
    this.serviceName = opts.serviceName;
    this.serviceKey = opts.serviceKey;
    this.environment = opts.NODE_ENV ?? process.env.NODE_ENV ?? "development";
    this.host = hostname();
    this.buffer = new LogBuffer(opts.maxBufferSize ?? 5e4);
    this.batchMaxEntries = Math.max(1, Math.min(500, opts.batchMaxEntries ?? 10));
    this.batchFlushMs = Math.max(100, opts.batchFlushMs ?? 2e3);
    const bridge = opts.logBridgeUrl?.trim();
    if (bridge) {
      const secret = (opts.logBridgeIngressSecret ?? process.env.LOG_BRIDGE_INGRESS_SECRET)?.trim();
      if (bridge.startsWith("https:") && !secret) {
        console.warn(
          "[shared-logger] LOG_BRIDGE_URL is HTTPS but LOG_BRIDGE_INGRESS_SECRET is empty; POST /system-logs may return 401."
        );
      }
      this.httpTransport = new HttpLogTransport({
        baseUrl: bridge,
        ingressSecret: secret || void 0,
        requestTimeoutMs: opts.httpRequestTimeoutMs ?? 15e3
      });
    }
  }
  clearHttpTimer() {
    if (this.httpBatchTimer) {
      clearTimeout(this.httpBatchTimer);
      this.httpBatchTimer = null;
    }
  }
  ensureHttpFlushTimer() {
    if (this.httpBatchTimer || !this.httpTransport || this.shuttingDown) return;
    this.httpBatchTimer = setTimeout(() => {
      this.httpBatchTimer = null;
      void this.flushHttpNow();
    }, this.batchFlushMs);
  }
  /**
   * Gửi tối đa `batchMaxEntries`; lặp nếu backlog lớn; hẹn timer cho phần còn lại.
   */
  async flushHttpNow() {
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
  scheduleHttpPipeline() {
    if (!this.httpTransport || this.shuttingDown) return;
    if (this.buffer.length >= this.batchMaxEntries) {
      void this.flushHttpNow();
      return;
    }
    this.ensureHttpFlushTimer();
  }
  scheduleStdoutDrain() {
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
  buildBase(level, message, fields) {
    const ctx = getLogContext();
    const traceId = fields?.traceId ?? ctx?.traceId ?? "no-trace";
    const service = fields?.service ?? ctx?.serviceName ?? this.serviceName;
    const serviceKey = fields?.serviceKey ?? ctx?.serviceKey ?? this.serviceKey;
    const base = {
      traceId,
      timestamp: fields?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      service,
      serviceKey,
      environment: fields?.environment ?? this.environment,
      hostname: fields?.hostname ?? this.host
    };
    return {
      ...base,
      ...fields,
      traceId,
      service,
      serviceKey,
      level,
      message
    };
  }
  log(level, message, fields) {
    const entry = compactLogEntryForTransport(this.buildBase(level, message, fields));
    this.buffer.enqueue(entry);
    if (this.httpTransport) {
      this.scheduleHttpPipeline();
    } else {
      this.scheduleStdoutDrain();
    }
  }
  debug(message, fields) {
    this.log("debug", message, fields);
  }
  info(message, fields) {
    this.log("info", message, fields);
  }
  warn(message, fields) {
    this.log("warn", message, fields);
  }
  error(message, fields) {
    this.log("error", message, fields);
  }
  fatal(message, fields) {
    this.log("fatal", message, fields);
  }
  /**
   * Nhật ký thao tác nghiệp vụ (user / service account), không phải access log.
   * Luôn `level: info` + `logType: audit`; bắt buộc `audit.action`.
   */
  audit(message, fields) {
    const { level: _ignoreLevel, logType: _ignoreLt, ...rest } = fields;
    this.log("info", message, { ...rest, logType: "audit" });
  }
  /**
   * Chờ Log Bridge `/health` (khi `logBridgeUrl` được cấu hình).
   */
  async waitUntilLogBridgeReady(timeoutMs = 15e3) {
    if (!this.httpTransport) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.httpTransport.healthCheck()) return true;
      } catch {
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }
  /** @deprecated Dùng waitUntilLogBridgeReady */
  async waitUntilPublisherReady(timeoutMs = 15e3) {
    return this.waitUntilLogBridgeReady(timeoutMs);
  }
  async shutdown(timeoutMs = 5e3) {
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
};
var singleton = null;
function createSharedLogger(opts) {
  singleton = new SharedLogger(opts);
  return singleton;
}
function getSharedLogger() {
  return singleton;
}
async function waitForLogBridgeReady(logBridgeUrl, timeoutMs = 15e3) {
  const url = logBridgeUrl?.trim();
  if (!url) return;
  const logger = getSharedLogger();
  const ok = await logger?.waitUntilLogBridgeReady(timeoutMs);
  if (!ok) {
    console.warn(
      `[shared-logger] Log Bridge not ready within ${timeoutMs}ms; entries may use stdout until reachable`
    );
  }
}
async function waitForSharedLoggerBroker(logBridgeUrl, timeoutMs) {
  return waitForLogBridgeReady(logBridgeUrl, timeoutMs);
}

export { HttpLogTransport, LogBuffer, SharedLogger, compactLogEntryForTransport, createSharedLogger, enterLogContext, getLogContext, getSharedLogger, getTraceIdOrFallback, runWithLogContext, waitForLogBridgeReady, waitForSharedLoggerBroker };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map