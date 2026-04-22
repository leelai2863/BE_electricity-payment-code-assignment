import mongoose from "mongoose";
import { ServiceError } from "@/modules/electric-bills/electric-bills.helpers";
import {
  createSplitBillEntry,
  findActiveSplitsByOriginalBill,
  findSplitBillEntryById,
  findElectricBillFullByCustomerYearMonth,
  updateSplitBillAmounts,
} from "@/modules/electric-bills/electric-bills.repository";
import { countOtherThuChiLinkedToSplit } from "@/modules/accounting-thu-chi/accounting-thu-chi.repository";
import { cancelBillSplit, patchSplitPeriod } from "@/modules/electric-bills/electric-bills.service";
import {
  HA_CUOC_SOURCE_DISPLAY,
  normalizeSourceForDedupe,
} from "@/modules/accounting-thu-chi/user-source-preference.repository";
import type { HaCuocContextLean } from "@/modules/accounting-thu-chi/accounting-thu-chi.repository";

const CUSTOMER_CODE_RE = /^[A-Z0-9]{10,16}$/;

export function isHaCuocSource(source: string): boolean {
  const n = normalizeSourceForDedupe(source);
  return n === normalizeSourceForDedupe(HA_CUOC_SOURCE_DISPLAY);
}

export function parseCustomerCodeFromDescription(description: string): string | null {
  const t = description.trim().toUpperCase().replace(/\s+/g, "");
  if (!CUSTOMER_CODE_RE.test(t)) return null;
  return t;
}

export function vnCalendarYearMonth(d: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "numeric",
  }).formatToParts(d);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new ServiceError(400, "Ngày hạch toán không hợp lệ để xác định tháng hóa đơn.", {
      code: "HA_CUOC_INVALID_DATE",
    });
  }
  return { year, month };
}

export function formatAnchorDdMmHoChiMinh(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(d);
  const dd = parts.find((p) => p.type === "day")?.value ?? "";
  const mm = parts.find((p) => p.type === "month")?.value ?? "";
  return `${dd}/${mm}`;
}

export type HaCuocResolveResult =
  | {
      ok: true;
      mode: "create";
      billId: string;
      ky: 1 | 2 | 3;
      originalAmount: number;
      customerCode: string;
      year: number;
      month: number;
      monthLabel: string;
      company: string;
      warnings: Array<{ code: string; message: string }>;
    }
  | {
      ok: true;
      mode: "resolveExisting";
      splitId: string;
      billId: string;
      ky: 1 | 2 | 3;
      originalAmount: number;
      split2Amount: number;
      customerCode: string;
      year: number;
      month: number;
      monthLabel: string;
      company: string;
      warnings: Array<{ code: string; message: string }>;
    };

type LeanSplit = {
  _id: mongoose.Types.ObjectId;
  originalBillId: string;
  originalKy: number;
  status: string;
  originalAmount?: number;
  createdBy?: string;
  split1?: { amount?: number; paymentConfirmed?: boolean; dealCompletedAt?: Date | null };
  split2?: { amount?: number; paymentConfirmed?: boolean; dealCompletedAt?: Date | null };
};

export async function resolveHaCuocTarget(params: {
  customerCode: string;
  amountOut: number;
  anchorDate: Date;
}): Promise<HaCuocResolveResult> {
  const amountOut = Math.trunc(Number(params.amountOut));
  if (!Number.isFinite(amountOut) || amountOut <= 0) {
    throw new ServiceError(400, "Số tiền chi phải lớn hơn 0.", { code: "HA_CUOC_VALIDATION_AMOUNT_NON_POSITIVE" });
  }

  const customerCode = params.customerCode.trim().toUpperCase().replace(/\s+/g, "");
  if (!CUSTOMER_CODE_RE.test(customerCode)) {
    throw new ServiceError(400, "Mã khách hàng không hợp lệ (ví dụ PC05II0947012).", {
      code: "HA_CUOC_INVALID_DESCRIPTION",
    });
  }

  const { year, month } = vnCalendarYearMonth(params.anchorDate);
  const bill = await findElectricBillFullByCustomerYearMonth(customerCode, year, month);
  if (!bill) {
    throw new ServiceError(
      404,
      `Không tìm thấy hóa đơn của mã ${customerCode} trong tháng ${month}/${year}. Kiểm tra lại ngày hạch toán hoặc mã khách hàng.`,
      { code: "HA_CUOC_BILL_NOT_FOUND" },
    );
  }

  const billId = String(bill._id);
  const splits = (await findActiveSplitsByOriginalBill(billId)) as LeanSplit[];
  const splitsByKy = new Map<number, LeanSplit>();
  for (const s of splits) splitsByKy.set(Number(s.originalKy), s);

  const warnings: Array<{ code: string; message: string }> = [];
  const company = String(bill.company ?? "").trim();
  if (company && company.toUpperCase() !== "V-GREEN") {
    warnings.push({
      code: "HA_CUOC_NON_VGREEN",
      message: `Hóa đơn thuộc company «${company}» — luồng mail/hoàn tiền có thể khác V-GREEN.`,
    });
  }

  const periods = Array.isArray(bill.periods) ? bill.periods : [];
  let sawEqualOnly = false;
  let lastEqualKy: number | null = null;
  let overAny = false;
  let manualConflictKy: number | null = null;
  let mismatchDetail: { ky: number; expected: number } | null = null;

  /** Còn split2 chưa xác nhận thanh toán → bắt buộc khớp số hoặc resolve; không tạo split mới ở kỳ khác. */
  for (const ky of [1, 2, 3] as const) {
    const active = splitsByKy.get(ky);
    if (!active || (active.createdBy ?? "manual") !== "thu-chi") continue;
    const s2amt =
      active.split2 && typeof active.split2.amount === "number" ? Math.trunc(active.split2.amount) : null;
    if (s2amt == null) continue;
    const s2paid = Boolean(active.split2?.paymentConfirmed);
    if (s2paid) continue;
    if (amountOut === s2amt) {
      const p = periods.find((x) => Number(x.ky) === ky);
      const amt = p && p.amount != null ? Math.trunc(Number(p.amount)) : 0;
      return {
        ok: true,
        mode: "resolveExisting",
        splitId: String(active._id),
        billId,
        ky,
        originalAmount: Math.trunc(Number(active.originalAmount ?? amt)),
        split2Amount: s2amt,
        customerCode,
        year,
        month,
        monthLabel: String(bill.monthLabel ?? ""),
        company,
        warnings,
      };
    }
    throw new ServiceError(
      400,
      `Kỳ ${ky} đã có split từ Thu chi. Phần còn lại cần trả là ${s2amt.toLocaleString("vi-VN")} đ. Số tiền bạn nhập ${amountOut.toLocaleString("vi-VN")} đ không khớp.`,
      { code: "HA_CUOC_SPLIT_EXISTS_AMOUNT_MISMATCH", ky, expectedAmount: s2amt },
    );
  }

  for (const ky of [1, 2, 3] as const) {
    const p = periods.find((x) => Number(x.ky) === ky);
    if (!p || p.amount == null || p.dealCompletedAt) continue;
    const amt = Math.trunc(Number(p.amount));
    if (!Number.isFinite(amt) || amt <= 0) continue;

    const active = splitsByKy.get(ky);
    if (active) {
      const createdBy = active.createdBy ?? "manual";
      if (createdBy === "manual") {
        manualConflictKy = ky;
        continue;
      }
      const s2amt =
        active.split2 && typeof active.split2.amount === "number" ? Math.trunc(active.split2.amount) : null;
      const s2paid = Boolean(active.split2?.paymentConfirmed);
      if (s2amt != null && amountOut === s2amt) {
        if (!s2paid) {
          return {
            ok: true,
            mode: "resolveExisting",
            splitId: String(active._id),
            billId,
            ky,
            originalAmount: Math.trunc(Number(active.originalAmount ?? amt)),
            split2Amount: s2amt,
            customerCode,
            year,
            month,
            monthLabel: String(bill.monthLabel ?? ""),
            company,
            warnings,
          };
        }
        continue;
      }
      if (createdBy === "thu-chi" && s2amt != null) {
        mismatchDetail = { ky, expected: s2amt };
      }
      continue;
    }

    if (amountOut === amt) {
      sawEqualOnly = true;
      lastEqualKy = ky;
      continue;
    }
    if (amountOut > amt) {
      overAny = true;
      continue;
    }
    if (amountOut > 0 && amountOut < amt) {
      return {
        ok: true,
        mode: "create",
        billId,
        ky,
        originalAmount: amt,
        customerCode,
        year,
        month,
        monthLabel: String(bill.monthLabel ?? ""),
        company,
        warnings,
      };
    }
  }

  if (manualConflictKy != null) {
    throw new ServiceError(
      409,
      `Kỳ ${manualConflictKy} đã được tách thủ công trước đó. Cập nhật dữ liệu cũ xong rồi mới nhập Thu chi Hạ Cước.`,
      { code: "HA_CUOC_MANUAL_CONFLICT", ky: manualConflictKy },
    );
  }

  if (mismatchDetail) {
    throw new ServiceError(
      400,
      `Kỳ ${mismatchDetail.ky} đã có split từ Thu chi. Phần còn lại cần trả là ${mismatchDetail.expected.toLocaleString("vi-VN")} đ. Số tiền bạn nhập ${amountOut.toLocaleString("vi-VN")} đ không khớp.`,
      { code: "HA_CUOC_SPLIT_EXISTS_AMOUNT_MISMATCH", ky: mismatchDetail.ky, expectedAmount: mismatchDetail.expected },
    );
  }

  if (sawEqualOnly && !overAny) {
    throw new ServiceError(
      400,
      `Số tiền chi bằng đúng số tiền kỳ ${lastEqualKy ?? "?"} — không cần hạ cước, đổi nguồn sang đại lý thanh toán bình thường.`,
      { code: "HA_CUOC_EQUAL_AMOUNT", ky: lastEqualKy },
    );
  }

  if (overAny) {
    throw new ServiceError(
      400,
      `Số tiền chi ${amountOut.toLocaleString("vi-VN")} đ lớn hơn số tiền các kỳ còn lại của mã ${customerCode}. Kiểm tra lại số tiền.`,
      { code: "HA_CUOC_OVER_AMOUNT" },
    );
  }

  throw new ServiceError(
    404,
    `Mã ${customerCode} chưa có kỳ nào có số tiền trong tháng ${month}/${year}.`,
    { code: "HA_CUOC_PERIOD_NOT_FOUND" },
  );
}

export async function previewHaCuoc(params: {
  customerCode: string;
  amountOut: number;
  anchorDate: Date;
}): Promise<{ data: HaCuocResolveResult }> {
  const resolved = await resolveHaCuocTarget(params);
  return { data: resolved };
}

function buildHaCuocContext(
  resolved: HaCuocResolveResult,
  amountOut: number,
  splitId: string | null,
  resolvedExistingSplit: boolean
): HaCuocContextLean {
  if (resolved.mode === "create") {
    return {
      kind: "HA_CUOC",
      customerCode: resolved.customerCode,
      targetBillId: resolved.billId,
      targetKy: resolved.ky,
      targetYear: resolved.year,
      targetMonth: resolved.month,
      originalAmount: resolved.originalAmount,
      splitAmount1: amountOut,
      createdSplitEntryId: splitId,
      resolvedExistingSplit,
    };
  }
  return {
    kind: "HA_CUOC",
    customerCode: resolved.customerCode,
    targetBillId: resolved.billId,
    targetKy: resolved.ky,
    targetYear: resolved.year,
    targetMonth: resolved.month,
    originalAmount: resolved.originalAmount,
    splitAmount1: amountOut,
    createdSplitEntryId: splitId,
    resolvedExistingSplit: true,
  };
}

export async function applyHaCuocAfterThuChiSaved(params: {
  entryId: string;
  source: string;
  description: string;
  chi: number | null;
  thu: number | null;
  anchorDate: Date;
}): Promise<HaCuocContextLean | null> {
  if (!isHaCuocSource(params.source)) return null;

  const code = parseCustomerCodeFromDescription(params.description);
  if (!code) {
    throw new ServiceError(400, "Nội dung phải là mã khách hàng hợp lệ (ví dụ PC05II0947012).", {
      code: "HA_CUOC_INVALID_DESCRIPTION",
    });
  }

  const thu = params.thu == null ? 0 : Math.trunc(Number(params.thu));
  const chi = params.chi == null ? 0 : Math.trunc(Number(params.chi));
  if (thu > 0) {
    throw new ServiceError(400, "Nghiệp vụ Hạ Cước chỉ dùng cột Chi (không nhập Thu).", { code: "HA_CUOC_INVALID_FLOW" });
  }
  if (chi <= 0) {
    throw new ServiceError(400, "Cần nhập số tiền Chi dương cho Hạ Cước.", { code: "HA_CUOC_VALIDATION_AMOUNT_NON_POSITIVE" });
  }

  const resolved = await resolveHaCuocTarget({ customerCode: code, amountOut: chi, anchorDate: params.anchorDate });
  const scanDdMm = formatAnchorDdMmHoChiMinh(params.anchorDate);

  if (resolved.mode === "create") {
    let splitId: string | null = null;
    try {
      const entry = await createSplitBillEntry({
        originalBillId: resolved.billId,
        originalKy: resolved.ky,
        customerCode: resolved.customerCode,
        monthLabel: resolved.monthLabel,
        month: resolved.month,
        year: resolved.year,
        originalAmount: resolved.originalAmount,
        split1: {
          amount: chi,
          paymentConfirmed: true,
          scanDdMm,
          cccdConfirmed: false,
        },
        split2: {
          amount: resolved.originalAmount - chi,
          paymentConfirmed: false,
          cccdConfirmed: false,
        },
        createdBy: "thu-chi",
        sourceThuChiId: params.entryId,
        lockedByThuChi: true,
      });
      splitId = String(entry._id);
      await patchSplitPeriod(splitId, 1, { paymentConfirmed: true, scanDdMm });
      return buildHaCuocContext(resolved, chi, splitId, false);
    } catch (err) {
      if (splitId) {
        try {
          await cancelBillSplit(splitId);
        } catch {
          /* ignore rollback errors */
        }
      }
      throw err;
    }
  }

  await patchSplitPeriod(resolved.splitId, 2, { paymentConfirmed: true, scanDdMm });
  return buildHaCuocContext(resolved, chi, resolved.splitId, true);
}

export async function revertHaCuocContext(ctx: HaCuocContextLean, thuChiEntryId: string): Promise<void> {
  const splitId = ctx.createdSplitEntryId;
  if (!splitId || !mongoose.isValidObjectId(splitId)) return;

  const ent = await findSplitBillEntryById(splitId);
  if (!ent) return;

  if (ent.status === "resolved") {
    throw new ServiceError(
      409,
      `Split của mã ${ctx.customerCode} kỳ ${ctx.targetKy} đã hoàn tất — không thể hoàn tác Thu chi.`,
      { code: "HA_CUOC_SPLIT_RESOLVED" },
    );
  }

  if (ctx.resolvedExistingSplit) {
    const s2 = ent.split2 as { paymentConfirmed?: boolean; dealCompletedAt?: Date | null };
    if (s2?.dealCompletedAt) {
      throw new ServiceError(409, "Kỳ tách đã hoàn tất — không thể hoàn tác Thu chi đợt 2.", {
        code: "HA_CUOC_SPLIT_RESOLVED",
      });
    }
    await patchSplitPeriod(splitId, 2, { paymentConfirmed: false, scanDdMm: null });
    return;
  }

  const others = await countOtherThuChiLinkedToSplit(splitId, thuChiEntryId);
  if (others > 0) {
    throw new ServiceError(
      409,
      "Còn dòng Thu chi Hạ Cước (đợt 2) gắn cùng split — xóa dòng đó trước.",
      { code: "HA_CUOC_DELETE_PRIMARY_BLOCKED" },
    );
  }

  await cancelBillSplit(splitId);
}

export async function updateHaCuocSplitAmountsIfNeeded(params: {
  ctx: HaCuocContextLean;
  newChi: number;
  anchorDate: Date;
}): Promise<HaCuocContextLean> {
  if (params.ctx.resolvedExistingSplit) {
    throw new ServiceError(409, "Dòng Thu chi đợt 2 (đóng split) không đổi số tiền tại đây — tạo bút toán điều chỉnh khác.", {
      code: "HA_CUOC_SPLIT_RESOLVED",
    });
  }
  const splitId = params.ctx.createdSplitEntryId;
  if (!splitId) throw new ServiceError(500, "Thiếu liên kết split", { code: "HA_CUOC_INTERNAL" });

  const ent = await findSplitBillEntryById(splitId);
  if (!ent || ent.status !== "active") {
    throw new ServiceError(409, "Split không còn hoạt động để cập nhật số tiền.", { code: "HA_CUOC_SPLIT_RESOLVED" });
  }

  const orig = Math.trunc(Number(ent.originalAmount ?? params.ctx.originalAmount));
  const a1 = Math.trunc(params.newChi);
  if (a1 <= 0 || a1 >= orig) {
    throw new ServiceError(
      400,
      `Số tiền chi phải lớn 0 và nhỏ hơn số tiền gốc kỳ (${orig.toLocaleString("vi-VN")} đ).`,
      { code: "HA_CUOC_EQUAL_AMOUNT" },
    );
  }
  const a2 = orig - a1;
  await updateSplitBillAmounts(splitId, a1, a2);
  const scanDdMm = formatAnchorDdMmHoChiMinh(params.anchorDate);
  await patchSplitPeriod(splitId, 1, { amount: a1, paymentConfirmed: true, scanDdMm });
  await patchSplitPeriod(splitId, 2, { amount: a2 });

  return {
    ...params.ctx,
    splitAmount1: a1,
  };
}
