/**
 * Structured log entry shipped to RabbitMQ (`fuji.logs.topic`) or stdout fallback.
 * Routing key: `logs.{serviceKey}.{level}` (matches binding `logs.#`).
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
/** Phân loại: kỹ thuật (access/endpoint) vs nghiệp vụ (thao tác người dùng). `system` khi bỏ qua. */
type LogType = 'system' | 'audit';
interface LogEntryError {
    message: string;
    stack?: string;
    code?: string;
}
/**
 * Payload cho `logType: 'audit'`: hành động nghiệp vụ (không thay thế access log).
 * `action` bắt buộc khi gửi audit.
 */
interface LogAuditPayload {
    /** Stable id, ví dụ `iam.user.update`, `crm.assign_payment_code` */
    action: string;
    module?: string;
    resourceType?: string;
    resourceId?: string;
    outcome?: 'success' | 'failure' | 'denied';
    /** Mô tả ngắn cho màn admin (không thay thế `message`). */
    summary?: string;
    actorType?: 'user' | 'service_account' | 'system';
    /** Chi tiết bổ sung (đã mask ở log-service khi trả API). */
    details?: Record<string, unknown>;
}
interface LogEntry {
    traceId: string;
    timestamp: string;
    level: LogLevel;
    message: string;
    /** Human-readable service name, e.g. `iam-service` */
    service: string;
    /** Routing key segment: `logs.{serviceKey}.{level}` — bắt buộc khi gửi qua Log Bridge. */
    serviceKey: string;
    environment: string;
    hostname: string;
    /**
     * `system` (mặc định nếu không gửi): access/endpoint; `audit`: thao tác nghiệp vụ có `audit`.
     */
    logType?: LogType;
    /** Bắt buộc khi `logType === 'audit'`. */
    audit?: LogAuditPayload;
    method?: string;
    url?: string;
    statusCode?: number;
    durationMs?: number;
    ip?: string;
    userAgent?: string;
    userId?: string;
    userEmail?: string;
    /** Email tài khoản / người bị tác động (khi khác actor), lọc CRM `targetEmail`. */
    targetUserEmail?: string;
    userRoles?: string[];
    authType?: 'bearer' | 'api_key';
    serviceAccountId?: string;
    error?: LogEntryError;
    /** Stable event id for audit / analytics, e.g. `iam.auth.login_success` */
    event?: string;
    metadata?: Record<string, unknown>;
}
/** Bound per-request context (AsyncLocalStorage). */
interface LogContext {
    traceId: string;
    serviceName: string;
    serviceKey: string;
}
interface SharedLoggerOptions {
    /** Display name, e.g. `iam-service` */
    serviceName: string;
    /** Short key for routing: `iam` | `gateway` | `mail` */
    serviceKey: string;
    /**
     * Base URL Log Bridge (HTTP), ví dụ `https://logs.nguyentrungnam.com`.
     * Không đặt → log chỉ ra stdout (JSON lines).
     */
    logBridgeUrl?: string;
    /** Bearer secret nếu bridge bật `LOG_BRIDGE_INGRESS_SECRET`. */
    logBridgeIngressSecret?: string;
    NODE_ENV?: string;
    /** Max buffered entries before aggressive drops (default 50_000) */
    maxBufferSize?: number;
    /** Gom batch tối đa N dòng trước khi POST (default 10). */
    batchMaxEntries?: number;
    /** Hoặc flush sau tối đa N ms nếu chưa đủ batch (default 2000). */
    batchFlushMs?: number;
    /** Timeout mỗi request HTTP (default 15000). */
    httpRequestTimeoutMs?: number;
}

/**
 * Run `fn` with log context set for the current async resource chain.
 */
declare function runWithLogContext<T>(ctx: LogContext, fn: () => T): T;
/**
 * Node 20+: bind context for the remainder of the current async continuation
 * (used from Fastify `onRequest` so downstream handlers see the same context).
 */
declare function enterLogContext(ctx: LogContext): void;
declare function getLogContext(): LogContext | undefined;
declare function getTraceIdOrFallback(fallback: string): string;

declare class SharedLogger {
    private readonly serviceName;
    private readonly serviceKey;
    private readonly environment;
    private readonly host;
    private readonly buffer;
    private readonly httpTransport;
    private readonly batchMaxEntries;
    private readonly batchFlushMs;
    private httpBatchTimer;
    private stdoutDrainScheduled;
    private shuttingDown;
    constructor(opts: SharedLoggerOptions);
    private clearHttpTimer;
    private ensureHttpFlushTimer;
    /**
     * Gửi tối đa `batchMaxEntries`; lặp nếu backlog lớn; hẹn timer cho phần còn lại.
     */
    private flushHttpNow;
    private scheduleHttpPipeline;
    private scheduleStdoutDrain;
    private buildBase;
    log(level: LogLevel, message: string, fields?: Partial<LogEntry>): void;
    debug(message: string, fields?: Partial<LogEntry>): void;
    info(message: string, fields?: Partial<LogEntry>): void;
    warn(message: string, fields?: Partial<LogEntry>): void;
    error(message: string, fields?: Partial<LogEntry>): void;
    fatal(message: string, fields?: Partial<LogEntry>): void;
    /**
     * Nhật ký thao tác nghiệp vụ (user / service account), không phải access log.
     * Luôn `level: info` + `logType: audit`; bắt buộc `audit.action`.
     */
    audit(message: string, fields: Partial<LogEntry> & {
        audit: LogAuditPayload;
    }): void;
    /**
     * Chờ Log Bridge `/health` (khi `logBridgeUrl` được cấu hình).
     */
    waitUntilLogBridgeReady(timeoutMs?: number): Promise<boolean>;
    /** @deprecated Dùng waitUntilLogBridgeReady */
    waitUntilPublisherReady(timeoutMs?: number): Promise<boolean>;
    shutdown(timeoutMs?: number): Promise<void>;
}
declare function createSharedLogger(opts: SharedLoggerOptions): SharedLogger;
declare function getSharedLogger(): SharedLogger | null;
/** Chờ Log Bridge sẵn sàng (hoặc no-op nếu không cấu hình URL). */
declare function waitForLogBridgeReady(logBridgeUrl: string | undefined, timeoutMs?: number): Promise<void>;
/** @deprecated Dùng waitForLogBridgeReady — tham số là Log Bridge base URL. */
declare function waitForSharedLoggerBroker(logBridgeUrl: string | undefined, timeoutMs?: number): Promise<void>;

declare class LogBuffer {
    private readonly maxSize;
    private readonly queue;
    constructor(maxSize?: number);
    get length(): number;
    enqueue(entry: LogEntry): boolean;
    private evictLowestPriority;
    dequeueBatch(max: number): LogEntry[];
    drainAll(): LogEntry[];
}

interface HttpLogTransportOptions {
    /** Base URL, ví dụ `https://logs.nguyentrungnam.com` (không có path). */
    baseUrl: string;
    /** Bearer token nếu LOG_BRIDGE_INGRESS_SECRET được bật trên bridge. */
    ingressSecret?: string;
    requestTimeoutMs?: number;
}
/**
 * HTTP keep-alive tới Log Bridge; POST `/system-logs` với body `{ entries }`.
 */
declare class HttpLogTransport {
    private readonly endpoint;
    private readonly healthUrl;
    private readonly ingressSecret?;
    private readonly timeoutMs;
    private readonly dispatcher;
    constructor(opts: HttpLogTransportOptions);
    sendBatch(entries: LogEntry[]): Promise<void>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
}

/**
 * Giảm kích thước batch gửi Log Bridge: bỏ field undefined, cắt UA/stack quá dài, giới hạn metadata.
 * Dữ liệu vẫn đủ cho access log + audit; chi tiết dài nên lưu ở stdout local nếu cần.
 */
declare function compactLogEntryForTransport(entry: LogEntry, opts?: {
    maxUserAgent?: number;
    maxStack?: number;
    maxMetadataKeys?: number;
}): LogEntry;

export { HttpLogTransport, type HttpLogTransportOptions, type LogAuditPayload, LogBuffer, type LogContext, type LogEntry, type LogEntryError, type LogLevel, type LogType, SharedLogger, type SharedLoggerOptions, compactLogEntryForTransport, createSharedLogger, enterLogContext, getLogContext, getSharedLogger, getTraceIdOrFallback, runWithLogContext, waitForLogBridgeReady, waitForSharedLoggerBroker };
