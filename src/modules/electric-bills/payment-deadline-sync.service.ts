import mongoose from "mongoose";
import { ServiceError } from "@/modules/electric-bills/electric-bills.helpers";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import {
  autocheckGetPaymentDue,
  readAutocheckEvnClientConfig,
  type AutocheckEvnClientConfig,
} from "@/lib/autocheck-evn-client";
import { buildPaymentDueRegionCandidates, type AutocheckRegionScope } from "@/lib/evn-region-candidates";
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
  /** Gửi AutoCheck theo tháng/năm chỉ định (force theo kỳ/tháng từ UI); bỏ qua evn_ky_bill / month refu. */
  billingThang?: number | null;
  billingNam?: number | null;
  /** Khi true: mọi lỗi/404 không ghi đè trạng thái cũ — khôi phục snapshot trước khi chạy. */
  revertOnFailure?: boolean;
  /** Chỉ từ UI targeted: cho phép kỳ đã giao đại lý vẫn gọi AutoCheck (sửa dữ liệu EVN). */
  allowAssignedKy?: boolean;
  /**
   * Kỳ đích không có `amount` trên Mongo nhưng vẫn hỏi AutoCheck theo đúng ky/tháng/năm;
   * dùng số tiền tham chiếu (max các kỳ khác có tiền) cho fingerprint / syncKey — API payment-due không cần tiền.
   */
  billingAmountForSync?: number;
};

const queue: PaymentDeadlineSyncJob[] = [];
const queuedKeys = new Set<string>();

/** Lần cuối xếp hàng job billId+ky (giảm spam AutoCheck / captcha). */
const lastEnqueueAtByJobKey = new Map<string, number>();

function minEnqueueGapMs(force: boolean): number {
  if (force) {
    return Math.max(0, Number(process.env.PAYMENT_DEADLINE_MIN_ENQUEUE_INTERVAL_FORCE_MS ?? 12_000) || 12_000);
  }
  return Math.max(0, Number(process.env.PAYMENT_DEADLINE_MIN_ENQUEUE_INTERVAL_MS ?? 30_000) || 30_000);
}

/** POST không truyền billIds (quét toàn bộ chờ giao) — hạn chế tần suất. */
let lastEmptyBillIdsBulkAt = 0;

function emptyBillIdsBulkCooldownMs(): number {
  return Math.max(
    0,
    Number(process.env.PAYMENT_DEADLINE_SYNC_EMPTY_BILL_IDS_COOLDOWN_MS ?? 120_000) || 120_000,
  );
}

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

function effectiveBillingThangNam(
  job: PaymentDeadlineSyncJob,
  bill: { month: number; year: number; evnKyBillThang?: number | null; evnKyBillNam?: number | null },
): { thang: number; nam: number } {
  const ot = job.billingThang;
  const on = job.billingNam;
  const overrideOk =
    ot != null &&
    on != null &&
    Number.isInteger(ot) &&
    Number.isInteger(on) &&
    ot >= 1 &&
    ot <= 12 &&
    on >= 2000 &&
    on <= 2100;
  if (overrideOk) {
    return { thang: ot, nam: on };
  }
  return billingThangNamForAutocheck(bill);
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

  const pd = p.paymentDeadline;
  const deadlineExpired =
    pd != null &&
    pd !== "" &&
    escalatePastKyEnabled() &&
    isPaymentDeadlineBeforeTodayVn(pd);

  /** Đồng bộ ok + đã có hạn còn hiệu lực (theo ngày VN) → không gọi AutoCheck lại (tránh lệch fingerprint amount). */
  if (st === "ok" && pd && !deadlineExpired) {
    return true;
  }

  /** ok + fingerprint khớp + hạn đã qua → không skip (cần leo kỳ / làm mới). */
  if (st === "ok" && key === syncKey && pd && deadlineExpired) {
    return false;
  }
  if ((st === "pending" || st === "running") && syncedAtStr) {
    const t = Date.parse(syncedAtStr);
    if (Number.isFinite(t) && Date.now() - t < STALE_PENDING_MS) {
      return true;
    }
  }
  return false;
}

/** Đủ điều kiện xếp hàng đồng bộ hạn TT (dùng khi so sánh kỳ cao/thấp). */
function canEnqueuePaymentDeadlineSyncForPeriod(
  bill: {
    month: number;
    year: number;
    evnKyBillThang?: number | null;
    evnKyBillNam?: number | null;
    periods: ElectricBillPeriod[];
  },
  p: ElectricBillPeriod,
  force: boolean,
): boolean {
  if (p.amount == null || !periodNeedsAssignment(p)) return false;
  if (p.paymentDeadline && !force) {
    const allowExpired =
      escalatePastKyEnabled() && isPaymentDeadlineBeforeTodayVn(p.paymentDeadline);
    if (!allowExpired) return false;
  }
  const { thang: bt, nam: bn } = billingThangNamForAutocheck(bill);
  const syncKey = computeSyncFingerprint(bn, bt, p.ky, p.amount);
  return !shouldSkipByState(p, syncKey, force);
}

const VN_TZ = "Asia/Ho_Chi_Minh";

function calendarYmdInTimeZone(isoOrDate: string | Date, timeZone: string): { y: number; m: number; d: number } | null {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const y = Number(parts.find((part) => part.type === "year")?.value);
  const m = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null;
  return { y, m, d: day };
}

function ymdToNum(y: number, m: number, d: number): number {
  return y * 10_000 + m * 100 + d;
}

/** Hạn (theo ngày lịch VN) trước hôm nay → coi đã qua, có thể gọi AutoCheck thêm kỳ k+1 (tối đa 3). */
function isPaymentDeadlineBeforeTodayVn(deadlineIso: string, now = new Date()): boolean {
  const dl = calendarYmdInTimeZone(deadlineIso, VN_TZ);
  const td = calendarYmdInTimeZone(now, VN_TZ);
  if (!dl || !td) return false;
  return ymdToNum(dl.y, dl.m, dl.d) < ymdToNum(td.y, td.m, td.d);
}

function escalatePastKyEnabled(): boolean {
  return (process.env.PAYMENT_DEADLINE_ESCALATE_PAST_KY ?? "true").trim().toLowerCase() !== "false";
}

function syncFieldsSnapshot(p: ElectricBillPeriod): Record<string, string | null | undefined> {
  return {
    paymentDeadline: p.paymentDeadline ?? null,
    evnPaymentDeadlineSyncStatus: p.evnPaymentDeadlineSyncStatus ?? null,
    evnPaymentDeadlineSyncError: p.evnPaymentDeadlineSyncError ?? null,
    evnPaymentDeadlineSyncedAt: p.evnPaymentDeadlineSyncedAt ?? null,
    evnPaymentDeadlineSyncKey: p.evnPaymentDeadlineSyncKey ?? null,
  };
}

function failureSyncPatch(
  job: PaymentDeadlineSyncJob,
  snapshot: Record<string, string | null | undefined> | null,
  kind: "error" | "no_data",
  message: string,
): Record<string, string | null | undefined> {
  const iso = new Date().toISOString();
  if (job.revertOnFailure && snapshot) {
    return { ...snapshot };
  }
  if (kind === "error") {
    return {
      evnPaymentDeadlineSyncStatus: "error",
      evnPaymentDeadlineSyncError: message.slice(0, 2000),
      evnPaymentDeadlineSyncedAt: iso,
    };
  }
  return {
    evnPaymentDeadlineSyncStatus: "no_data",
    evnPaymentDeadlineSyncError: message.slice(0, 2000),
    evnPaymentDeadlineSyncedAt: iso,
  };
}

type ResolvedPaymentDue =
  | { ok: true; hanThanhToanIso: string; ky: 1 | 2 | 3 }
  | { ok: false; status: number; code?: string; message: string };

/**
 * Gọi `payment-due` lần lượt cho **mọi kỳ** `startKy…3` (khi `PAYMENT_DEADLINE_ESCALATE_PAST_KY` bật).
 * Nếu **một** kỳ trả 200: dùng đúng kỳ đó (hành vi cũ).
 * Nếu **từ hai kỳ trở lên** trả 200: ưu tiên **kỳ số cao hơn** làm nguồn sự thật EVN (kỳ sau thay thế kỳ trước), không so ngày hạn.
 * Khi escalate tắt: chỉ gọi đúng `startKy` (một GET).
 */
async function resolvePaymentDueWithPastKyEscalation(
  cfg: AutocheckEvnClientConfig,
  bill: { customerCode: string; periods: ElectricBillPeriod[] },
  region: AutocheckRegionScope,
  startKy: 1 | 2 | 3,
  billThang: number,
  billNam: number,
  opts?: { allowAssignedStartKy?: boolean },
): Promise<ResolvedPaymentDue> {
  const ma = bill.customerCode.trim();
  const call = (ky: 1 | 2 | 3) =>
    autocheckGetPaymentDue(cfg, {
      maKhachHang: ma,
      region,
      ky,
      thang: billThang,
      nam: billNam,
    });

  const kyEnd: number = escalatePastKyEnabled() ? 3 : startKy;
  const successes: Array<{ ky: 1 | 2 | 3; hanThanhToanIso: string }> = [];
  let lastNonOk: ResolvedPaymentDue | null = null;

  const allowAssignedStartKy = Boolean(opts?.allowAssignedStartKy);

  for (let k = startKy; k <= kyEnd; k++) {
    const ky = k as 1 | 2 | 3;
    const pRow = bill.periods.find((p) => p.ky === ky);
    if (k === startKy) {
      if (pRow && !periodNeedsAssignment(pRow) && !allowAssignedStartKy) {
        return { ok: false, status: 0, message: `Kỳ ${ky} đã gán đại lý — không tra payment-due.` };
      }
      if (!pRow || pRow.amount == null || !Number.isFinite(pRow.amount)) {
        return { ok: false, status: 0, message: `Kỳ ${ky} thiếu số tiền trên hóa đơn.` };
      }
    }
    // k > startKy: luôn gọi payment-due (hạn EVN có thể ở kỳ cao hơn dù CRM đã giao kỳ đó).

    const r = await call(ky);
    if (!r.ok) {
      if (!lastNonOk || (lastNonOk.status === 404 && r.status !== 404)) {
        lastNonOk = r;
      }
      continue;
    }
    successes.push({ ky, hanThanhToanIso: r.hanThanhToanIso });
  }

  if (successes.length === 0) {
    return lastNonOk ?? { ok: false, status: 404, message: "Không có payment-due cho các kỳ đã thử." };
  }

  if (successes.length === 1) {
    const only = successes[0]!;
    return { ok: true, hanThanhToanIso: only.hanThanhToanIso, ky: only.ky };
  }

  const best = successes.reduce((a, b) => (b.ky > a.ky ? b : a));
  return { ok: true, hanThanhToanIso: best.hanThanhToanIso, ky: best.ky };
}

function applyPeriodSyncFields(
  periods: ElectricBillPeriod[],
  ky: 1 | 2 | 3,
  patch: Record<string, string | null | undefined>,
): ElectricBillPeriod[] {
  return periods.map((p) => (p.ky === ky ? ({ ...p, ...patch } as ElectricBillPeriod) : p));
}

/**
 * EVN chốt `finalKy` > `jobKy` nhưng tiền/quét đang nằm nhầm ở `jobKy` (thiết kế cũ: vào trước = k1).
 * Chuyển các field hóa đơn sang đúng slot kỳ khi ô `finalKy` chưa có tiền và cả hai kỳ vẫn chờ giao.
 */
function relocateUnassignedBillingFromJobKyToFinalKy(
  periods: ElectricBillPeriod[],
  jobKy: 1 | 2 | 3,
  finalKy: 1 | 2 | 3,
): ElectricBillPeriod[] {
  if (finalKy <= jobKy) return periods;
  const src = periods.find((p) => p.ky === jobKy);
  const dst = periods.find((p) => p.ky === finalKy);
  if (!src || !dst) return periods;
  if (!periodNeedsAssignment(src) || !periodNeedsAssignment(dst)) return periods;
  if (src.amount == null || !Number.isFinite(src.amount)) return periods;
  if (dst.amount != null && Number.isFinite(dst.amount)) return periods;

  const keys: (keyof ElectricBillPeriod)[] = [
    "amount",
    "scanDate",
    "scanDdMm",
    "ca",
    "customerName",
    "cardType",
    "paymentConfirmed",
    "cccdConfirmed",
    "dealCompletedAt",
  ];

  return periods.map((p) => {
    if (p.ky === finalKy) {
      const merged = { ...p } as ElectricBillPeriod;
      for (const k of keys) {
        (merged as unknown as Record<string, unknown>)[k as string] = src[k] as unknown;
      }
      return merged;
    }
    if (p.ky === jobKy) {
      const cleared = { ...p } as ElectricBillPeriod;
      for (const k of keys) {
        if (k === "amount") (cleared as unknown as Record<string, unknown>).amount = null;
        else if (k === "paymentConfirmed" || k === "cccdConfirmed")
          (cleared as unknown as Record<string, unknown>)[k as string] = false;
        else (cleared as unknown as Record<string, unknown>)[k as string] = null;
      }
      return cleared;
    }
    return p;
  });
}

async function saveBillPeriods(billId: string, periods: ElectricBillPeriod[]): Promise<void> {
  const doc = await ElectricBillRecord.findById(new mongoose.Types.ObjectId(billId));
  if (!doc) return;
  doc.set("periods", periodsDtoToMongoSchema(periods) as typeof doc.periods);
  doc.markModified("periods");
  await doc.save();
}

function amountForPaymentDeadlineJob(job: PaymentDeadlineSyncJob, period: ElectricBillPeriod): number | null {
  if (period.amount != null && Number.isFinite(period.amount)) {
    return Math.round(period.amount);
  }
  if (job.billingAmountForSync != null && Number.isFinite(job.billingAmountForSync)) {
    return Math.round(job.billingAmountForSync);
  }
  return null;
}

/** Số tiền cho syncKey: ưu tiên amount kỳ đích; không có thì dùng tiền kỳ job (leo kỳ / AutoCheck trả hạn kỳ cao hơn). */
function amountForFinalKy(
  job: PaymentDeadlineSyncJob,
  periodAtJobKy: ElectricBillPeriod,
  finalKy: 1 | 2 | 3,
  periodFinal: ElectricBillPeriod | undefined,
  fallbackAmt: number,
): number | null {
  if (periodFinal?.amount != null && Number.isFinite(periodFinal.amount)) {
    return Math.round(periodFinal.amount);
  }
  if (job.billingAmountForSync != null && Number.isFinite(job.billingAmountForSync)) {
    return Math.round(job.billingAmountForSync);
  }
  return fallbackAmt;
}

async function runOneJob(job: PaymentDeadlineSyncJob): Promise<void> {
  const cfg = readAutocheckEvnClientConfig();
  const raw = await findElectricBillById(job.billId);
  if (!raw) return;

  const bill = serializeElectricBill(raw as unknown as Record<string, unknown>);
  const period = bill.periods.find((p) => p.ky === job.ky);
  if (!period) {
    return;
  }
  const amt = amountForPaymentDeadlineJob(job, period);
  if (amt == null) {
    return;
  }
  if (!job.allowAssignedKy && !periodNeedsAssignment(period)) {
    return;
  }

  const { thang: billThang, nam: billNam } = effectiveBillingThangNam(job, bill);
  const syncKey = computeSyncFingerprint(billNam, billThang, job.ky, amt);
  if (shouldSkipByState(period, syncKey, job.force)) {
    return;
  }

  const snapshotForRevert = job.revertOnFailure ? syncFieldsSnapshot(period) : null;

  try {
    const nowIso = new Date().toISOString();
    let next = applyPeriodSyncFields(bill.periods, job.ky, {
      evnPaymentDeadlineSyncStatus: "running",
      evnPaymentDeadlineSyncError: null,
      evnPaymentDeadlineSyncedAt: nowIso,
    } as Record<string, string | null | undefined>);
    await saveBillPeriods(job.billId, next);

    if (!cfg.baseUrl) {
      next = applyPeriodSyncFields(
        next,
        job.ky,
        failureSyncPatch(job, snapshotForRevert, "error", "Chưa cấu hình AUTOCHECK_EVN_URL trên elec-service."),
      );
      await saveBillPeriods(job.billId, next);
      return;
    }

    if (!bill.customerCode?.trim()) {
      next = applyPeriodSyncFields(
        next,
        job.ky,
        failureSyncPatch(job, snapshotForRevert, "error", "Thiếu mã khách hàng."),
      );
      await saveBillPeriods(job.billId, next);
      return;
    }

    const regions = buildPaymentDueRegionCandidates(bill.customerCode, bill.evn);
    const tried: string[] = [];
    let lastMessage = "";

    for (const region of regions) {
      tried.push(region);
      const resolved = await resolvePaymentDueWithPastKyEscalation(
        cfg,
        bill,
        region as AutocheckRegionScope,
        job.ky,
        billThang,
        billNam,
        { allowAssignedStartKy: Boolean(job.allowAssignedKy) },
      );
      if (resolved.ok) {
        const finalKy = resolved.ky;
        const slotFinalBefore = next.find((p) => p.ky === finalKy);
        if (
          finalKy > job.ky &&
          slotFinalBefore &&
          (slotFinalBefore.amount == null || !Number.isFinite(slotFinalBefore.amount))
        ) {
          next = relocateUnassignedBillingFromJobKyToFinalKy(next, job.ky, finalKy);
        }
        const periodFinal = next.find((p) => p.ky === finalKy);
        const amtFinal = amountForFinalKy(job, period, finalKy, periodFinal, amt);
        if (amtFinal == null) {
          lastMessage = `${region}: thiếu số tiền kỳ ${finalKy}`;
          continue;
        }
        const syncKeyFinal = computeSyncFingerprint(billNam, billThang, finalKy, amtFinal);
        if (finalKy !== job.ky) {
          // Không khôi phục paymentDeadline cũ của kỳ job — nếu không, bảng Giao mã (ưu tiên hạn muộn nhất)
          // vẫn chọn nhầm kỳ job dù EVN đã chốt hạn ở finalKy.
          next = applyPeriodSyncFields(next, job.ky, {
            paymentDeadline: null,
            evnPaymentDeadlineSyncStatus: null,
            evnPaymentDeadlineSyncError: null,
            evnPaymentDeadlineSyncedAt: null,
            evnPaymentDeadlineSyncKey: null,
          } as Record<string, string | null | undefined>);
        }
        next = applyPeriodSyncFields(next, finalKy, {
          paymentDeadline: resolved.hanThanhToanIso,
          evnPaymentDeadlineSyncStatus: "ok",
          evnPaymentDeadlineSyncError: null,
          evnPaymentDeadlineSyncedAt: new Date().toISOString(),
          evnPaymentDeadlineSyncKey: syncKeyFinal,
        } as Record<string, string | null | undefined>);
        await saveBillPeriods(job.billId, next);
        return;
      }
      lastMessage = `${region}: ${resolved.message}${resolved.code ? ` (${resolved.code})` : ""}`;
      if (resolved.status !== 404) {
        next = applyPeriodSyncFields(next, job.ky, failureSyncPatch(job, snapshotForRevert, "error", lastMessage));
        await saveBillPeriods(job.billId, next);
        return;
      }
    }

    const noDataMsg = `Không có payment-due (404) sau khi đã thử kỳ 1→3 theo vùng. Đã thử: ${tried.join(", ")}. ${lastMessage}`;
    next = applyPeriodSyncFields(next, job.ky, failureSyncPatch(job, snapshotForRevert, "no_data", noDataMsg));
    await saveBillPeriods(job.billId, next);
  } catch (e) {
    if (!snapshotForRevert) {
      throw e;
    }
    try {
      const raw2 = await findElectricBillById(job.billId);
      if (raw2) {
        const bill2 = serializeElectricBill(raw2 as unknown as Record<string, unknown>);
        const restored = applyPeriodSyncFields(
          bill2.periods,
          job.ky,
          snapshotForRevert as Record<string, string | null | undefined>,
        );
        await saveBillPeriods(job.billId, restored);
      }
    } catch {
      /* ignore */
    }
  }
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

export function enqueuePaymentDeadlineSync(job: PaymentDeadlineSyncJob): "queued" | "duplicate" | "cooldown" {
  const k = jobKey(job);
  if (queuedKeys.has(k)) return "duplicate";
  const gap = minEnqueueGapMs(job.force);
  const last = lastEnqueueAtByJobKey.get(k) ?? 0;
  if (gap > 0 && Date.now() - last < gap) {
    return "cooldown";
  }
  lastEnqueueAtByJobKey.set(k, Date.now());
  queuedKeys.add(k);
  queue.push(job);
  return "queued";
}

export type EnqueueUnassignedPaymentDeadlineBody = {
  billIds?: string[];
  force?: boolean;
  requestedBy?: "system" | "user";
  /** Force một bill + kỳ + tháng/năm AutoCheck; thất bại không ghi đè trạng thái EVN cũ (revert). */
  targeted?: {
    billId: string;
    ky: 1 | 2 | 3;
    billingThang: number;
    billingNam: number;
  };
};

export function parseTargetedPaymentDeadline(raw: unknown): {
  billId: string;
  ky: 1 | 2 | 3;
  billingThang: number;
  billingNam: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const billId = typeof o.billId === "string" ? o.billId.trim() : "";
  const kyNum = Number(o.ky);
  if (!billId || (kyNum !== 1 && kyNum !== 2 && kyNum !== 3)) return null;
  const billingThang = Number(o.billingThang);
  const billingNam = Number(o.billingNam);
  if (
    !Number.isInteger(billingThang) ||
    billingThang < 1 ||
    billingThang > 12 ||
    !Number.isInteger(billingNam) ||
    billingNam < 2000 ||
    billingNam > 2100
  ) {
    return null;
  }
  return { billId, ky: kyNum as 1 | 2 | 3, billingThang, billingNam };
}

/**
 * Xếp hàng đồng bộ hạn TT (theo kỳ) cho các bill chờ giao.
 * Trùng billId+ky trong RAM sẽ không enqueue lại; cooldown giữa các lần xếp hàng cùng billId+ky; trùng trạng thái DB do worker bỏ qua.
 */
export async function enqueueUnassignedPaymentDeadlineSync(
  body: EnqueueUnassignedPaymentDeadlineBody,
): Promise<{ enqueued: number; duplicate: number; skipped: number; cooldown: number }> {
  const targeted = parseTargetedPaymentDeadline(body.targeted);
  if (targeted) {
    const requestedBy = body.requestedBy === "user" ? "user" : "system";
    const raw = await findElectricBillById(targeted.billId);
    if (!raw) {
      throw new ServiceError(404, "Không tìm thấy hóa đơn.");
    }
    const bill = serializeElectricBill(raw as unknown as Record<string, unknown>);
    const p = bill.periods.find((x) => x.ky === targeted.ky);
    if (!p) {
      throw new ServiceError(400, "Không tìm thấy kỳ trên hóa đơn.");
    }
    let billingAmountForSync: number | undefined;
    if (p.amount == null || !Number.isFinite(p.amount)) {
      const refAmounts = bill.periods
        .filter((x) => x.ky !== targeted.ky && x.amount != null && Number.isFinite(x.amount))
        .map((x) => Math.round(Number(x.amount)));
      if (refAmounts.length === 0) {
        throw new ServiceError(
          400,
          "Kỳ chọn chưa có số tiền và không có kỳ khác trên hóa đơn có tiền — hãy bổ sung amount cho kỳ trên hóa đơn.",
        );
      }
      billingAmountForSync = Math.max(...refAmounts);
    }
    let enqueued = 0;
    let duplicate = 0;
    const skipped = 0;
    let cooldown = 0;
    const r = enqueuePaymentDeadlineSync({
      billId: targeted.billId,
      ky: targeted.ky,
      force: true,
      requestedBy,
      billingThang: targeted.billingThang,
      billingNam: targeted.billingNam,
      revertOnFailure: true,
      allowAssignedKy: true,
      ...(billingAmountForSync != null ? { billingAmountForSync } : {}),
    });
    if (r === "queued") enqueued += 1;
    else if (r === "duplicate") duplicate += 1;
    else cooldown += 1;
    return { enqueued, duplicate, skipped, cooldown };
  }

  const force = Boolean(body.force);
  const requestedBy = body.requestedBy === "user" ? "user" : "system";
  const ids = Array.isArray(body.billIds) ? body.billIds.filter((x) => typeof x === "string" && x.trim()) : [];

  if (ids.length === 0) {
    const cool = emptyBillIdsBulkCooldownMs();
    const now = Date.now();
    if (!force && cool > 0 && now - lastEmptyBillIdsBulkAt < cool) {
      const waitSec = Math.ceil((cool - (now - lastEmptyBillIdsBulkAt)) / 1000);
      throw new ServiceError(
        429,
        `Đồng bộ toàn bộ danh sách chờ giao chỉ nên gọi mỗi ${Math.ceil(cool / 60_000)} phút (giảm tải). Thử lại sau ${waitSec}s hoặc truyền billIds cụ thể.`,
      );
    }
    lastEmptyBillIdsBulkAt = now;
  }

  let enqueued = 0;
  let duplicate = 0;
  let skipped = 0;
  let cooldown = 0;

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
        const allowExpiredResync =
          escalatePastKyEnabled() && isPaymentDeadlineBeforeTodayVn(p.paymentDeadline);
        if (!allowExpiredResync) {
          skipped += 1;
          continue;
        }
      }
      const ky = p.ky;
      const { thang: bt, nam: bn } = billingThangNamForAutocheck(bill);
      const syncKey = computeSyncFingerprint(bn, bt, ky, p.amount);
      if (shouldSkipByState(p, syncKey, force)) {
        skipped += 1;
        continue;
      }
      if (
        !force &&
        escalatePastKyEnabled() &&
        p.paymentDeadline &&
        isPaymentDeadlineBeforeTodayVn(p.paymentDeadline) &&
        p.ky < 3
      ) {
        const preferHigher = bill.periods.some(
          (c) => c.ky > p.ky && canEnqueuePaymentDeadlineSyncForPeriod(bill, c, force),
        );
        if (preferHigher) {
          skipped += 1;
          continue;
        }
      }
      const r = enqueuePaymentDeadlineSync({ billId, ky, force, requestedBy });
      if (r === "queued") enqueued += 1;
      else if (r === "duplicate") duplicate += 1;
      else cooldown += 1;
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

  return { enqueued, duplicate, skipped, cooldown };
}