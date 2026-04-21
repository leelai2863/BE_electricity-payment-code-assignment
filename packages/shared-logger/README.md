# `@core-x/shared-logger`

Structured logging for Core-X microservices: **non-blocking** buffer → **HTTP POST** tới **Log Bridge** (hoặc **stdout JSON** nếu không cấu hình URL).

- **Transport:** `undici` keep-alive agent, batch mặc định **10** dòng hoặc mỗi **2s** (tuỳ chỉnh).
- **Tracing:** `enterLogContext()` / `runWithLogContext()` + `AsyncLocalStorage` cho `traceId` + `serviceKey`.
- **Resilience:** buffer ưu tiên (drop `debug`/`info` trước khi đầy), fallback stdout khi bridge lỗi.

**Chuẩn hợp đồng:** [docs/LOG-INGRESS-STANDARD.md](../../docs/LOG-INGRESS-STANDARD.md).  
Luồng & env: [docs/LOG-BRIDGE.md](../../docs/LOG-BRIDGE.md), tích hợp 5 bước: [docs/SHARED-LOGGER-INTEGRATION.md](../../docs/SHARED-LOGGER-INTEGRATION.md).

## Install (monorepo workspace)

```json
{
  "dependencies": {
    "@core-x/shared-logger": "*"
  }
}
```

## Quick start

```typescript
import { createSharedLogger, enterLogContext, waitForLogBridgeReady } from '@core-x/shared-logger';

createSharedLogger({
  serviceName: 'my-service',
  serviceKey: 'myservice',
  logBridgeUrl: process.env.LOG_BRIDGE_URL,
  logBridgeIngressSecret: process.env.LOG_BRIDGE_INGRESS_SECRET,
  NODE_ENV: process.env.NODE_ENV,
});

await waitForLogBridgeReady(process.env.LOG_BRIDGE_URL);

enterLogContext({
  traceId: 'uuid-or-header',
  serviceName: 'my-service',
  serviceKey: 'myservice',
});

getSharedLogger()?.info('hello', { event: 'myservice.startup', metadata: { foo: 1 } });
```

## Environment

| Variable | Description |
|----------|-------------|
| `LOG_BRIDGE_URL` | Base URL Log Bridge (path `/system-logs` do client tự thêm; dấu `/` cuối base URL được strip). |
| `LOG_BRIDGE_INGRESS_SECRET` | Bearer nếu bridge bật secret; với `https://` mà thiếu secret, client in **cảnh báo** (dễ 401). |

Mỗi `LogEntry` có `serviceKey` — routing phía broker: `logs.{serviceKey}.{level}`.

## Shutdown

```typescript
await getSharedLogger()?.shutdown(5_000);
```

## API

`LogEntry`, `SharedLoggerOptions` trong `src/types.ts`. Export: `createSharedLogger`, `getSharedLogger`, `waitForLogBridgeReady`, `HttpLogTransport`, context helpers.
