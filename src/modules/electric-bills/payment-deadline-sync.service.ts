import mongoose from "mongoose";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import {
  autocheckGetPaymentDue,
  autocheckPollTaskUntilTerminal,
  autocheckPostCpcScrapeTask,
  readAutocheckEvnClientConfig,
} from "@/lib/autocheck-evn-client";
import { buildPaymentDueRegionCandidates } from "@/lib/evn-region-candidates";
import { serializeElectricBill } from "@/lib/electric-bill-serialize";
import { periodsDtoToMongoSchema } from "@/lib/electric-bill-mongo-periods";
import type { ElectricBillPeriod } from "@/types/electric-bill";
import {
  findElectricBillById,
  findUnassignedCandidateBills,
} from "@/modules/electric-bills/electric-bills.repository";

export type PaymentDeadlineSyncJob = {
  billId: string;
  ky: 1 | 2 | 3;
  force: boolean;
  requestedBy: "system" | "user";
};

const queue: PaymentDeadlineSyncJob[] = [];
const queuedKeys = new Set<string>();

const STALE_PENDING_MS = 4 * 60 * 1000;

function jobKey(j: PaymentDeadlineSyncJob): string {
  return `${j.billId}_k${j.ky}`;
}

function computeSyncFingerprint(year: number, month: number, ky: number, amount: number): string {
  return `${year}-${month}-k${ky}-a${amount}`;
}

/** Tháng/năm gửi AutoCheck: chỉ neo EVN khi đủ cặp hợp lệ; tránh ghép tháng EVN + năm refu sai. */
function billingThangNamForAutocheck(bill: { month: number; year: number; evnKyBillThang?: number | null; evnKyBillNam?: number | null }): {
  thang: number;
  nam: number;
} {
  const t = bill.evnKyBillThang;
  const n = bill.evnKyBillNam;
  const pairOk =
    t != null &&
    n != null &&
    Number.isInteger(t) &&
    Number.isInteger(n) &&
    t >= 1 &&
    t <= 12 &&
    n >= 2000 &&
    n <= 2100;
  if (pairOk) {
    return { thang: t, nam: n };
  }
  return { thang: bill.month, nam: bill.year };
}

function periodNeedsAssignment(p: ElectricBillPeriod): boolean {
  if (p.amount == null) return false;
  const ag = (p.assignedAgencyId ?? "").trim();
  return !ag;
}

function shouldSkipByState(
  p: ElectricBillPeriod,
  syncKey: string,
  force: boolean,
): boolean {
  if (force) return false;
  const st = p.evnPaymentDeadlineSyncStatus ?? null;
  const key = p.evnPaymentDeadlineSyncKey ?? null;
  const syncedAtStr = p.evnPaymentDeadlineSyncedAt ?? null;
  if (st === "ok" && key === syncKey && p.paymentDeadline) {
    return true;
  }
  if ((st === "pending" || st === "running") && syncedAtStr) {
    const t = Date.parse(syncedAtStr);
    if (Number.isFinite(t) && Date.now() - t < STALE_PENDING_MS) {
      return true;
    }
  }
  return false;
}

function applyPeriodSyncFields(
  periods: ElectricBillPeriod[],
  ky: 1 | 2 | 3,
  patch: Record<string, string | null | undefined>,
): ElectricBillPeriod[] {
  return periods.map((p) => (p.ky === ky ? ({ ...p, ...patch } as ElectricBillPeriod) : p));
}

async function saveBillPeriods(billId: string, periods: ElectricBillPeriod[]): Promise<void> {
  const doc = await ElectricBillRecord.findById(new mongoose.Types.ObjectId(billId));
  if (!doc) return;
  doc.set("periods", periodsDtoToMongoSchema(periods) as typeof doc.periods);
  doc.markModified("periods");
  await doc.save();
}

async function runOneJob(job: PaymentDeadlineSyncJob): Promise<void> {
  const cfg = readAutocheckEvnClientConfig();
  const raw = await findElectricBillById(job.billId);
  if (!raw) return;

  const bill = serializeElectricBill(raw as unknown as Record<string, unknown>);
  const period = bill.periods.find((p) => p.ky === job.ky);
  if (!period || period.amount == null || !periodNeedsAssignment(period)) {
    return;
  }

  const { thang: billThang, nam: billNam } = billingThangNamForAutocheck(bill);
  const syncKey = computeSyncFingerprint(billNam, billThang, job.ky, period.amount);
  if (shouldSkipByState(period, syncKey, job.force)) {
    return;
  }

  const nowIso = new Date().toISOString();
  let next = applyPeriodSyncFields(bill.periods, job.ky, {
    evnPaymentDeadlineSyncStatus: "running",
    evnPaymentDeadlineSyncError: null,
    evnPaymentDeadlineSyncedAt: nowIso,
  } as Record<string, string | null | undefined>);
  await saveBillPeriods(job.billId, next);

  if (!cfg.baseUrl) {
    next = applyPeriodSyncFields(next, job.ky, {
      evnPaymentDeadlineSyncStatus: "error",
      evnPaymentDeadlineSyncError: "Chưa cấu hình AUTOCHECK_EVN_URL trên elec-service.",
      evnPaymentDeadlineSyncedAt: new Date().toISOString(),
    } as Record<string, string | null | undefined>);
    await saveBillPeriods(job.billId, next);
    return;
  }

  if (!bill.customerCode?.trim()) {
    next = applyPeriodSyncFields(next, job.ky, {
      evnPaymentDeadlineSyncStatus: "error",
      evnPaymentDeadlineSyncError: "Thiếu mã khách hàng.",
      evnPaymentDeadlineSyncedAt: new Date().toISOString(),
    } as Record<string, string | null | undefined>);
    await saveBillPeriods(job.billId, next);
    return;
  }

  const regions = buildPaymentDueRegionCandidates(bill.customerCode, bill.evn);
  const tried: string[] = [];
  let lastMessage = "";

  for (const region of regions) {
    tried.push(region);
    const r = await autocheckGetPaymentDue(cfg, {
      maKhachHang: bill.customerCode,
      region,
      ky: job.ky,
      thang: billThang,
      nam: billNam,
    });
    if (r.ok) {
      next = applyPeriodSyncFields(next, job.ky, {
        paymentDeadline: r.hanThanhToanIso,
        evnPaymentDeadlineSyncStatus: "ok",
        evnPaymentDeadlineSyncError: null,
        evnPaymentDeadlineSyncedAt: new Date().toISOString(),
        evnPaymentDeadlineSyncKey: syncKey,
      } as Record<string, string | null | undefined>);
      await saveBillPeriods(job.billId, next);
      return;
    }
    lastMessage = `${region}: ${r.message}${r.code ? ` (${r.code})` : ""}`;
    if (r.status !== 404) {
      next = applyPeriodSyncFields(next, job.ky, {
        evnPaymentDeadlineSyncStatus: "error",
        evnPaymentDeadlineSyncError: lastMessage.slice(0, 2000),
        evnPaymentDeadlineSyncedAt: new Date().toISOString(),
      } as Record<string, string | null | undefined>);
      await saveBillPeriods(job.billId, next);
      return;
    }
  }

  const cpcScrape =
    (process.env.PAYMENT_DEADLINE_CPC_SCRAPE_ON_404 ?? "true").trim().toLowerCase() !== "false";
  if (cpcScrape && regions.includes("EVN_CPC")) {
    const t = await autocheckPostCpcScrapeTask(cfg, { ky: job.ky, thang: billThang, nam: billNam });
    if (!t.ok) {
      next = applyPeriodSyncFields(next, job.ky, {
        evnPaymentDeadlineSyncStatus: "error",
        evnPaymentDeadlineSyncError: `Sau 404, không tạo được task quét CPC: ${t.message}`.slice(0, 2000),
        evnPaymentDeadlineSyncedAt: new Date().toISOString(),
      } as Record<string, string | null | undefined>);
      await saveBillPeriods(job.billId, next);
      return;
    }
    const poll = await autocheckPollTaskUntilTerminal(cfg, t.taskId);
    if (!poll.ok || poll.status !== "SUCCESS") {
      const err =
        !poll.ok ? poll.message : poll.errorMessage ?? `Task CPC ${poll.status}`;
      next = applyPeriodSyncFields(next, job.ky, {
        evnPaymentDeadlineSyncStatus: "error",
        evnPaymentDeadlineSyncError: `Quét CPC kỳ ${job.ky} T${billThang}/${billNam}: ${err}`.slice(0, 2000),
        evnPaymentDeadlineSyncedAt: new Date().toISOString(),
      } as Record<string, string | null | undefined>);
      await saveBillPeriods(job.billId, next);
      return;
    }
    const r2 = await autocheckGetPaymentDue(cfg, {
      maKhachHang: bill.customerCode,
      region: "EVN_CPC",
      ky: job.ky,
      thang: billThang,
      nam: billNam,
    });
    if (r2.ok) {
      next = applyPeriodSyncFields(next, job.ky, {
        paymentDeadline: r2.hanThanhToanIso,
        evnPaymentDeadlineSyncStatus: "ok",
        evnPaymentDeadlineSyncError: null,
        evnPaymentDeadlineSyncedAt: new Date().toISOString(),
        evnPaymentDeadlineSyncKey: syncKey,
      } as Record<string, string | null | undefined>);
      await saveBillPeriods(job.billId, next);
      return;
    }
    lastMessage = `Sau quét CPC: ${r2.message}`;
  }

  next = applyPeriodSyncFields(next, job.ky, {
    evnPaymentDeadlineSyncStatus: "no_data",
    evnPaymentDeadlineSyncError:
      `Không có bản thông báo đã parse (404). Đã thử: ${tried.join(", ")}. ${lastMessage}`.slice(0, 2000),
    evnPaymentDeadlineSyncedAt: new Date().toISOString(),
  } as Record<string, string | null | undefined>);
  await saveBillPeriods(job.billId, next);
}

let workerStarted = false;

export function startPaymentDeadlineSyncWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const tickMs = Math.max(300, Number(process.env.PAYMENT_DEADLINE_SYNC_TICK_MS ?? 700) || 700);
  setInterval(() => {
    void (async () => {
      const job = queue.shift();
      if (!job) return;
      queuedKeys.delete(jobKey(job));
      try {
        await runOneJob(job);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          const raw = await findElectricBillById(job.billId);
          if (!raw) return;
          const bill = serializeElectricBill(raw as unknown as Record<string, unknown>);
          const next = applyPeriodSyncFields(bill.periods, job.ky, {
            evnPaymentDeadlineSyncStatus: "error",
            evnPaymentDeadlineSyncError: msg.slice(0, 2000),
            evnPaymentDeadlineSyncedAt: new Date().toISOString(),
          } as Record<string, string | null | undefined>);
          await saveBillPeriods(job.billId, next);
        } catch {
          /* ignore */
        }
      }
    })();
  }, tickMs);
}

export function enqueuePaymentDeadlineSync(job: PaymentDeadlineSyncJob): "queued" | "duplicate" {
  const k = jobKey(job);
  if (queuedKeys.has(k)) return "duplicate";
  queuedKeys.add(k);
  queue.push(job);
  return "queued";
}

export type EnqueueUnassignedPaymentDeadlineBody = {
  billIds?: string[];
  force?: boolean;
  requestedBy?: "system" | "user";
};

/**
 * Xếp hàng đồng bộ hạn TT (theo kỳ) cho các bill chờ giao.
 * Trùng billId+ky trong RAM sẽ không enqueue lại; trùng trạng thái DB (ok + cùng fingerprint) do worker bỏ qua.
 */
export async function enqueueUnassignedPaymentDeadlineSync(
  body: EnqueueUnassignedPaymentDeadlineBody,
): Promise<{ enqueued: number; duplicate: number; skipped: number }> {
  const force = Boolean(body.force);
  const requestedBy = body.requestedBy === "user" ? "user" : "system";
  const ids = Array.isArray(body.billIds) ? body.billIds.filter((x) => typeof x === "string" && x.trim()) : [];

  let enqueued = 0;
  let duplicate = 0;
  let skipped = 0;

  const considerBill = async (billId: string) => {
    const raw = await findElectricBillById(billId);
    if (!raw) {
      skipped += 1;
      return;
    }
    const bill = serializeElectricBill(raw as unknown as Record<string, unknown>);
    for (const p of bill.periods) {
      if (p.amount == null || !periodNeedsAssignment(p)) continue;
      if (p.paymentDeadline && !force) {
        skipped += 1;
        continue;
      }
      const ky = p.ky;
      const { thang: bt, nam: bn } = billingThangNamForAutocheck(bill);
      const syncKey = computeSyncFingerprint(bn, bt, ky, p.amount);
      if (shouldSkipByState(p, syncKey, force)) {
        skipped += 1;
        continue;
      }
      const r = enqueuePaymentDeadlineSync({ billId, ky, force, requestedBy });
      if (r === "queued") enqueued += 1;
      else duplicate += 1;
    }
  };

  if (ids.length > 0) {
    for (const id of ids) await considerBill(id.trim());
  } else {
    const docs = await findUnassignedCandidateBills();
    const bills = docs
      .map((d) => serializeElectricBill(d as unknown as Record<string, unknown>))
      .filter((bill) =>
        bill.periods.some((p) => p.amount != null && (!p.assignedAgencyId || !String(p.assignedAgencyId).trim())),
      );
    for (const b of bills) await considerBill(b._id);
  }

  return { enqueued, duplicate, skipped };
}