import type { AutocheckRegionScope } from "@/lib/evn-region-candidates";

export type AutocheckEvnClientConfig = {
  baseUrl: string;
  apiKey: string;
  httpTimeoutMs: number;
  taskPollIntervalMs: number;
  taskPollMaxMs: number;
};

export function readAutocheckEvnClientConfig(): AutocheckEvnClientConfig {
  const baseUrl = (process.env.AUTOCHECK_EVN_URL ?? "").trim().replace(/\/$/, "");
  const apiKey = (process.env.AUTOCHECK_EVN_API_KEY ?? "").trim();
  const httpTimeoutMs = Math.max(5000, Number(process.env.AUTOCHECK_EVN_HTTP_TIMEOUT_MS ?? 28_000) || 28_000);
  const taskPollIntervalMs = Math.max(500, Number(process.env.AUTOCHECK_EVN_TASK_POLL_MS ?? 2000) || 2000);
  const taskPollMaxMs = Math.max(10_000, Number(process.env.AUTOCHECK_EVN_TASK_POLL_MAX_MS ?? 180_000) || 180_000);
  return { baseUrl, apiKey, httpTimeoutMs, taskPollIntervalMs, taskPollMaxMs };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function authHeaders(cfg: AutocheckEvnClientConfig): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (cfg.apiKey) h["x-api-key"] = cfg.apiKey;
  return h;
}

export type PaymentDueResult =
  | { ok: true; hanThanhToanIso: string }
  | { ok: false; status: number; code?: string; message: string };

/** GET /api/tools/bills/customer/:ma/payment-due — luôn truyền đủ ky, thang, nam (không dùng latest để tránh lệch đồng bộ). */
export async function autocheckGetPaymentDue(
  cfg: AutocheckEvnClientConfig,
  params: {
    maKhachHang: string;
    region: AutocheckRegionScope;
    ky: number;
    thang: number;
    nam: number;
  },
): Promise<PaymentDueResult> {
  if (!cfg.baseUrl) {
    return { ok: false, status: 0, message: "Chưa cấu hình AUTOCHECK_EVN_URL." };
  }
  const u = new URL(
    `${cfg.baseUrl}/api/tools/bills/customer/${encodeURIComponent(params.maKhachHang.trim().toUpperCase())}/payment-due`,
  );
  u.searchParams.set("region", params.region);
  u.searchParams.set("ky", String(params.ky));
  u.searchParams.set("thang", String(params.thang));
  u.searchParams.set("nam", String(params.nam));

  let res: Response;
  try {
    res = await fetchWithTimeout(
      u.toString(),
      { method: "GET", headers: authHeaders(cfg) },
      cfg.httpTimeoutMs,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, message: msg.includes("abort") ? "Timeout kết nối AutoCheckEvn." : msg };
  }

  const text = await res.text();
  if (!res.ok) {
    let code: string | undefined;
    let message = text.slice(0, 500);
    try {
      const j = JSON.parse(text) as { error?: string; code?: string };
      if (j?.error) message = j.error;
      if (j?.code) code = j.code;
    } catch {
      /* raw */
    }
    return { ok: false, status: res.status, code, message };
  }

  try {
    const j = JSON.parse(text) as {
      hanThanhToan?: string;
      kyBill?: { ky?: unknown; thang?: unknown; nam?: unknown };
    };
    const iso = j?.hanThanhToan;
    if (!iso || typeof iso !== "string") {
      return { ok: false, status: res.status, message: "Phản hồi AutoCheckEvn thiếu hanThanhToan." };
    }
    const kb = j.kyBill;
    if (kb && (kb.ky !== undefined || kb.thang !== undefined || kb.nam !== undefined)) {
      const rk = Number(kb.ky);
      const rt = Number(kb.thang);
      const rn = Number(kb.nam);
      if (
        rk === params.ky &&
        rt === params.thang &&
        rn === params.nam &&
        Number.isFinite(rk) &&
        Number.isFinite(rt) &&
        Number.isFinite(rn)
      ) {
        /* matched requested period */
      } else {
        const kbLabel =
          Number.isFinite(rk) && Number.isFinite(rt) && Number.isFinite(rn)
            ? `k${rk} T${rt}/${rn}`
            : JSON.stringify(kb);
        return {
          ok: false,
          status: res.status,
          code: "PERIOD_MISMATCH",
          message: `Hạn TT trả về không khớp kỳ yêu cầu (yêu cầu k${params.ky} T${params.thang}/${params.nam}, DB kyBill ${kbLabel}).`,
        };
      }
    }
    return { ok: true, hanThanhToanIso: iso };
  } catch {
    return { ok: false, status: res.status, message: "Không parse được JSON từ AutoCheckEvn." };
  }
}

export type TaskPollResult =
  | { ok: true; status: "SUCCESS" | "FAILED" | "CANCELLED"; errorMessage?: string }
  | { ok: false; message: string };

export type TaskSnapshot =
  | { ok: true; status: string; errorMessage?: string }
  | { ok: false; message: string };

export async function autocheckPostCpcScrapeTask(
  cfg: AutocheckEvnClientConfig,
  params: { ky: number; thang: number; nam: number },
): Promise<{ ok: true; taskId: string; isDuplicate?: boolean } | { ok: false; message: string }> {
  if (!cfg.baseUrl) {
    return { ok: false, message: "Chưa cấu hình AUTOCHECK_EVN_URL." };
  }
  const url = `${cfg.baseUrl}/api/tasks`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
        body: JSON.stringify({ ky: params.ky, thang: params.thang, nam: params.nam }),
      },
      cfg.httpTimeoutMs,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
  const text = await res.text();
  try {
    const j = JSON.parse(text) as {
      taskId?: string;
      isDuplicate?: boolean;
      error?: string;
      status?: string;
    };
    if (!res.ok) {
      return { ok: false, message: j?.error ?? text.slice(0, 400) };
    }
    const taskId = j?.taskId;
    if (!taskId) return { ok: false, message: "POST /api/tasks không trả taskId." };
    return { ok: true, taskId, isDuplicate: Boolean(j?.isDuplicate) };
  } catch {
    return { ok: false, message: text.slice(0, 400) };
  }
}

export async function autocheckGetTask(cfg: AutocheckEvnClientConfig, taskId: string): Promise<TaskSnapshot> {
  if (!cfg.baseUrl) return { ok: false, message: "Chưa cấu hình AUTOCHECK_EVN_URL." };
  const url = `${cfg.baseUrl}/api/tasks/${encodeURIComponent(taskId)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: "GET", headers: authHeaders(cfg) }, cfg.httpTimeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { status?: string; errorMessage?: string; error?: string };
    if (!res.ok) {
      return { ok: false, message: j?.error ?? text.slice(0, 400) };
    }
    const st = j?.status ?? "UNKNOWN";
    return { ok: true, status: st, errorMessage: j?.errorMessage };
  } catch {
    return { ok: false, message: text.slice(0, 400) };
  }
}

/** Poll tới terminal hoặc hết thời gian. */
export async function autocheckPollTaskUntilTerminal(
  cfg: AutocheckEvnClientConfig,
  taskId: string,
): Promise<TaskPollResult> {
  const deadline = Date.now() + cfg.taskPollMaxMs;
  while (Date.now() < deadline) {
    const r = await autocheckGetTask(cfg, taskId);
    if (!r.ok) return { ok: false, message: r.message };
    if (r.status === "SUCCESS" || r.status === "FAILED" || r.status === "CANCELLED") {
      return { ok: true, status: r.status, errorMessage: r.errorMessage };
    }
    await new Promise((res) => setTimeout(res, cfg.taskPollIntervalMs));
  }
  return { ok: false, message: `Hết thời gian chờ task ${taskId} (${cfg.taskPollMaxMs}ms).` };
}

type EnsureBillQueuedResponse = {
  outcome?: string;
  taskId?: string;
  status?: string;
  agentMessage?: string;
  error?: string;
  code?: string;
};

type EnsureBillCacheResponse = {
  outcome?: string;
  agentMessage?: string;
};

function isQueuedEnsureOutcome(outcome: string | undefined): boolean {
  return outcome === "queued" || outcome === "already_queued";
}

async function postEnsureBill(
  cfg: AutocheckEvnClientConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; outcome: "cache_hit" | "queued" | "already_queued"; taskId?: string } | { ok: false; message: string }> {
  if (!cfg.baseUrl) {
    return { ok: false, message: "Chưa cấu hình AUTOCHECK_EVN_URL." };
  }
  const url = `${cfg.baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      cfg.httpTimeoutMs,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg.includes("abort") ? "Timeout gọi ensure-bill AutoCheckEvn." : msg };
  }

  const text = await res.text();
  let parsed: EnsureBillQueuedResponse | EnsureBillCacheResponse | null = null;
  try {
    parsed = JSON.parse(text) as EnsureBillQueuedResponse | EnsureBillCacheResponse;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const msg =
      (parsed as EnsureBillQueuedResponse | null)?.error ??
      (parsed as EnsureBillQueuedResponse | null)?.agentMessage ??
      text.slice(0, 500);
    return { ok: false, message: msg };
  }

  const outcome = String((parsed as EnsureBillQueuedResponse | null)?.outcome ?? "");
  if (outcome === "cache_hit") {
    return { ok: true, outcome: "cache_hit" };
  }
  if (isQueuedEnsureOutcome(outcome)) {
    const taskId = (parsed as EnsureBillQueuedResponse | null)?.taskId;
    if (!taskId) {
      return { ok: false, message: "ensure-bill trả queued nhưng thiếu taskId." };
    }
    return { ok: true, outcome: outcome as "queued" | "already_queued", taskId };
  }
  return {
    ok: false,
    message:
      (parsed as EnsureBillQueuedResponse | null)?.agentMessage ??
      "ensure-bill trả outcome không hợp lệ.",
  };
}

async function waitEnsureTaskIfNeeded(
  cfg: AutocheckEvnClientConfig,
  ensure: { ok: true; outcome: "cache_hit" | "queued" | "already_queued"; taskId?: string } | { ok: false; message: string },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!ensure.ok) return ensure;
  if (ensure.outcome === "cache_hit") {
    return { ok: true, message: "ensure-bill cache_hit" };
  }
  const taskId = ensure.taskId;
  if (!taskId) return { ok: false, message: "Thiếu taskId để poll ensure-bill." };
  const polled = await autocheckPollTaskUntilTerminal(cfg, taskId);
  if (!polled.ok) {
    return { ok: false, message: `Poll ensure-bill thất bại: ${polled.message}` };
  }
  if (polled.status !== "SUCCESS") {
    return {
      ok: false,
      message: `Task ensure-bill kết thúc ${polled.status}${polled.errorMessage ? `: ${polled.errorMessage}` : ""}`,
    };
  }
  return { ok: true, message: `ensure-bill task ${taskId} SUCCESS` };
}

export async function autocheckEnsureNpcBillAndWait(
  cfg: AutocheckEvnClientConfig,
  params: { maKhachHang: string; ky: number; thang: number; nam: number },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const ensure = await postEnsureBill(cfg, "/api/npc/ensure-bill", {
    maKhachHang: params.maKhachHang,
    ky: params.ky,
    thang: params.thang,
    nam: params.nam,
    source: "assign-refu-payment-deadline-sync",
  });
  return waitEnsureTaskIfNeeded(cfg, ensure);
}

export async function autocheckEnsureHanoiBillAndWait(
  cfg: AutocheckEvnClientConfig,
  params: { maKhachHang: string; ky: number; thang: number; nam: number },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const ensure = await postEnsureBill(cfg, "/api/hanoi/ensure-bill", {
    maKhachHang: params.maKhachHang,
    ky: params.ky,
    thang: params.thang,
    nam: params.nam,
    source: "assign-refu-payment-deadline-sync",
  });
  return waitEnsureTaskIfNeeded(cfg, ensure);
}
