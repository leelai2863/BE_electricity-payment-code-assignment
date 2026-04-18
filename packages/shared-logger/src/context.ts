import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogContext } from './types';

const storage = new AsyncLocalStorage<LogContext>();

/**
 * Run `fn` with log context set for the current async resource chain.
 */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Node 20+: bind context for the remainder of the current async continuation
 * (used from Fastify `onRequest` so downstream handlers see the same context).
 */
export function enterLogContext(ctx: LogContext): void {
  storage.enterWith(ctx);
}

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}

export function getTraceIdOrFallback(fallback: string): string {
  return storage.getStore()?.traceId ?? fallback;
}
