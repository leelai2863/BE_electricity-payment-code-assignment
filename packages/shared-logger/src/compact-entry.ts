import type { LogEntry, LogAuditPayload } from './types';

const DEFAULT_MAX_USER_AGENT = 256;
const DEFAULT_MAX_STACK = 6000;
const DEFAULT_MAX_METADATA_KEYS = 32;
const DEFAULT_MAX_AUDIT_SUMMARY = 2000;
const DEFAULT_MAX_AUDIT_DETAILS_KEYS = 24;

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

/**
 * Giảm kích thước batch gửi Log Bridge: bỏ field undefined, cắt UA/stack quá dài, giới hạn metadata.
 * Dữ liệu vẫn đủ cho access log + audit; chi tiết dài nên lưu ở stdout local nếu cần.
 */
export function compactLogEntryForTransport(
  entry: LogEntry,
  opts?: { maxUserAgent?: number; maxStack?: number; maxMetadataKeys?: number },
): LogEntry {
  const maxUa = opts?.maxUserAgent ?? DEFAULT_MAX_USER_AGENT;
  const maxStack = opts?.maxStack ?? DEFAULT_MAX_STACK;
  const maxMetaKeys = opts?.maxMetadataKeys ?? DEFAULT_MAX_METADATA_KEYS;

  let next: LogEntry = { ...entry };

  if (next.userAgent && next.userAgent.length > maxUa) {
    next = { ...next, userAgent: `${next.userAgent.slice(0, maxUa)}…` };
  }

  if (next.error?.stack && next.error.stack.length > maxStack) {
    next = {
      ...next,
      error: { ...next.error, stack: `${next.error.stack.slice(0, maxStack)}\n…(truncated)` },
    };
  }

  if (next.metadata && typeof next.metadata === 'object' && !Array.isArray(next.metadata)) {
    const entries = Object.entries(next.metadata).filter(([, v]) => v !== undefined);
    const sliced = entries.slice(0, maxMetaKeys);
    const meta = Object.fromEntries(sliced);
    if (Object.keys(meta).length === 0) {
      const { metadata: _omit, ...rest } = next;
      void _omit;
      next = rest;
    } else {
      next = { ...next, metadata: meta };
    }
  }

  if (next.audit && typeof next.audit === 'object') {
    const a = next.audit as LogAuditPayload;
    const summary =
      a.summary && a.summary.length > DEFAULT_MAX_AUDIT_SUMMARY
        ? `${a.summary.slice(0, DEFAULT_MAX_AUDIT_SUMMARY)}…`
        : a.summary;
    let details = a.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const entries = Object.entries(details).filter(([, v]) => v !== undefined);
      const sliced = entries.slice(0, DEFAULT_MAX_AUDIT_DETAILS_KEYS);
      details = Object.fromEntries(sliced);
    }
    const compactAudit: LogAuditPayload = { action: a.action };
    if (a.module !== undefined) compactAudit.module = a.module;
    if (a.resourceType !== undefined) compactAudit.resourceType = a.resourceType;
    if (a.resourceId !== undefined) compactAudit.resourceId = a.resourceId;
    if (a.outcome !== undefined) compactAudit.outcome = a.outcome;
    if (a.actorType !== undefined) compactAudit.actorType = a.actorType;
    if (summary !== undefined) compactAudit.summary = summary;
    if (details !== undefined) compactAudit.details = details;
    next = { ...next, audit: compactAudit };
  }

  return stripUndefined(next as unknown as Record<string, unknown>) as unknown as LogEntry;
}
