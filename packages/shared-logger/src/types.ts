/**
 * Structured log entry shipped to RabbitMQ (`fuji.logs.topic`) or stdout fallback.
 * Routing key: `logs.{serviceKey}.{level}` (matches binding `logs.#`).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Phân loại: kỹ thuật (access/endpoint) vs nghiệp vụ (thao tác người dùng). `system` khi bỏ qua. */
export type LogType = 'system' | 'audit';

export interface LogEntryError {
  message: string;
  stack?: string;
  code?: string;
}

/**
 * Payload cho `logType: 'audit'`: hành động nghiệp vụ (không thay thế access log).
 * `action` bắt buộc khi gửi audit.
 */
export interface LogAuditPayload {
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

export interface LogEntry {
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
export interface LogContext {
  traceId: string;
  serviceName: string;
  serviceKey: string;
}

export interface SharedLoggerOptions {
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
