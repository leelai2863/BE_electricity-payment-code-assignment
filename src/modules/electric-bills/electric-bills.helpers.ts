import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { normalizeScanDdMmInput } from "@/lib/scan-ddmm";
import type { ElectricBillDto, ElectricBillPeriod } from "@/types/electric-bill";

export class ServiceError extends Error {
  status: number;
  payload?: Record<string, unknown>;

  constructor(status: number, message: string, payload?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export type AmountFilter = "lt30" | "lt70" | "lt100" | "lt300" | "lte500" | "gt500";
export const VALID_AMOUNT_FILTERS = new Set<string>([
  "lt30",
  "lt70",
  "lt100",
  "lt300",
  "lte500",
  "gt500",
]);

const M = 1_000_000;

export type InvoiceSortBy =
  | "customerCode"
  | "evn"
  | "month"
  | "year"
  | "assignedAt"
  | "updatedAt"
  | "createdAt"
  | "_id";

export type SortDir = "asc" | "desc";

export type InvoiceListParams = {
  page: number;
  pageSize: number;
  customerCode?: string;
  evn?: string;
  assignedAgencyName?: string;
  scanDdMm?: string;
  paymentDeadline?: string;
  month?: number;
  year?: number;
  done?: boolean;
  includeArchived: boolean;
  updatedAfter?: Date;
  sortBy: InvoiceSortBy;
  sortDir: SortDir;
  cursor?: string;
  includeFacets: boolean;
};

export type PeriodPatch = (Partial<Omit<ElectricBillPeriod, "ky">> & { ky: 1 | 2 | 3 })[];

export type PatchBody = {
  customerName?: string | null;
  paymentConfirmed?: boolean;
  cccdConfirmed?: boolean;
  cardType?: string | null;
  assignedAgencyId?: string | null;
  assignedAgencyName?: string | null;
  assignedAt?: string | null;
  dealCompletedAt?: string | null;
  /** Kỳ hóa đơn EVN (kyBill) — khi khác month/year refu; null để xóa neo */
  evnKyBillThang?: number | null;
  evnKyBillNam?: number | null;
  periods?: PeriodPatch;
  /**
   * Chỉ SUPER_ADMIN: xóa toàn bộ dữ liệu một kỳ (số tiền, gán mã, xác nhận, …).
   * Không gửi kèm `periods` hay các trường cập nhật hóa đơn khác — chỉ `resetPeriodKy` + actor.
   */
  resetPeriodKy?: 1 | 2 | 3;
  actorUserId?: string;
  actorRoles?: string[] | null;
};

export type RefundLinePatchBodyItem = {
  billId: string;
  ky: 1 | 2 | 3;
  /** 0 = dòng kỳ; 1|2 = mã con hạ cước */
  splitPart?: 0 | 1 | 2;
  agencyName: string;
  year: number;
  month: number;
  amount?: number | null;
  cardType?: string | null;
  scanDdMm: string | null;
  dealCompletedAt: string;
  status?: string;
  daHoan?: number;
  phiPctOverride?: number | null;
};

const INVOICE_SORT_FIELD_MAP: Record<InvoiceSortBy, string> = {
  customerCode: "customerCode",
  evn: "evn",
  month: "month",
  year: "year",
  assignedAt: "assignedAt",
  updatedAt: "updatedAt",
  createdAt: "createdAt",
  _id: "_id",
};

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function ensureDb() {
  try {
    await connectDB();
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không kết nối được MongoDB"));
  }
}

export function toBool(raw: unknown): boolean | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

export function toPositiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function billTotalAmount(bill: ElectricBillDto): number {
  return bill.periods.reduce((sum, p) => sum + (p.amount ?? 0), 0);
}

export function passesAmountFilter(total: number, filter: AmountFilter): boolean {
  switch (filter) {
    case "lt30":
      return total < 30 * M;
    case "lt70":
      return total >= 30 * M && total < 70 * M;
    case "lt100":
      return total >= 70 * M && total < 100 * M;
    case "lt300":
      return total >= 100 * M && total < 300 * M;
    case "lte500":
      return total >= 300 * M && total <= 500 * M;
    case "gt500":
      return total > 500 * M;
  }
}

export function completedAmountPeriods(periods: ElectricBillPeriod[]): ElectricBillPeriod[] {
  return periods.filter((p) => p.amount != null && Boolean(p.dealCompletedAt));
}

export function parseInvoiceListParams(query: Record<string, unknown>): InvoiceListParams {
  const page = toPositiveInt(query.page, 1);
  const pageSize = Math.min(500, toPositiveInt(query.pageSize, 100));
  const monthRaw = Number(query.month);
  const yearRaw = Number(query.year);
  const done = toBool(query.done);
  const includeArchived = toBool(query.includeArchived) ?? false;
  const includeFacets = toBool(query.includeFacets) ?? false;
  const updatedAfterRaw = typeof query.updatedAfter === "string" ? query.updatedAfter : undefined;
  const updatedAfter = updatedAfterRaw ? new Date(updatedAfterRaw) : undefined;
  const sortDir = (String(query.sortDir ?? "asc").toLowerCase() === "desc" ? "desc" : "asc") as SortDir;
  const sortByRaw = String(query.sortBy ?? "customerCode") as InvoiceSortBy;
  const sortBy: InvoiceSortBy = INVOICE_SORT_FIELD_MAP[sortByRaw] ? sortByRaw : "customerCode";
  const cursor =
    typeof query.cursor === "string" && mongoose.isValidObjectId(query.cursor) ? query.cursor : undefined;

  return {
    page,
    pageSize,
    customerCode: typeof query.customerCode === "string" ? query.customerCode.trim() : undefined,
    evn: typeof query.evn === "string" ? query.evn.trim() : undefined,
    assignedAgencyName:
      typeof query.assignedAgencyName === "string" ? query.assignedAgencyName.trim() : undefined,
    scanDdMm: typeof query.scanDdMm === "string" ? query.scanDdMm.trim() : undefined,
    paymentDeadline: typeof query.paymentDeadline === "string" ? query.paymentDeadline.trim() : undefined,
    month: Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : undefined,
    year: Number.isInteger(yearRaw) && yearRaw >= 2000 ? yearRaw : undefined,
    done,
    includeArchived,
    updatedAfter: updatedAfter && !Number.isNaN(updatedAfter.getTime()) ? updatedAfter : undefined,
    sortBy,
    sortDir,
    cursor,
    includeFacets,
  };
}

export function buildInvoiceListMatch(params: InvoiceListParams): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  if (params.customerCode) {
    and.push({ customerCode: { $regex: escapeRegex(params.customerCode), $options: "i" } });
  }

  if (params.evn) {
    and.push({ evn: { $regex: escapeRegex(params.evn), $options: "i" } });
  }

  // NOTE: `assignedAgencyName` filter được xử lý ở service layer (getInvoiceList) để có thể
  // match cả các bill có split1/split2 thuộc đại lý đó (vì agency của split nằm ở collection
  // SplitBillEntry, không nằm trong `bill.periods[]`).

  if (params.scanDdMm) {
    and.push({ periods: { $elemMatch: { scanDdMm: params.scanDdMm } } });
  }

  if (params.paymentDeadline) {
    const d = new Date(params.paymentDeadline);
    if (!Number.isNaN(d.getTime())) {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      and.push({ periods: { $elemMatch: { paymentDeadline: { $gte: start, $lte: end } } } });
    }
  }

  if (params.month != null) and.push({ month: params.month });
  if (params.year != null) and.push({ year: params.year });
  if (params.updatedAfter) and.push({ updatedAt: { $gt: params.updatedAfter } });

  if (params.done === true) {
    and.push({ periods: { $elemMatch: { amount: { $ne: null } } } });
    and.push({
      periods: { $not: { $elemMatch: { amount: { $ne: null }, dealCompletedAt: null } } },
    });
  } else if (params.done === false || !params.includeArchived) {
    // Điều kiện "chưa xong" gồm cả bill đang có SplitBillEntry active — gắn trong getInvoiceList
    // (distinctOriginalBillIdsWithActiveSplits + $or), tránh mất bill khi kỳ cha đã có dealCompletedAt nhầm.
  }

  return and.length > 0 ? { $and: and } : {};
}

/** Gộp thêm mệnh đề $and (Mongo) — dùng mở rộng match danh sách hóa đơn theo split active. */
export function mergeMongoAndClause(
  base: Record<string, unknown>,
  clause: Record<string, unknown>
): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  if (base && Object.keys(base).length > 0) {
    if (Array.isArray(base.$and)) {
      parts.push(...(base.$and as Record<string, unknown>[]));
    } else {
      parts.push(base);
    }
  }
  parts.push(clause);
  return { $and: parts };
}

export function invoiceListSort(
  sortBy: InvoiceSortBy,
  sortDir: SortDir
): Record<string, 1 | -1> {
  const field = INVOICE_SORT_FIELD_MAP[sortBy] ?? "customerCode";
  const dir: 1 | -1 = sortDir === "desc" ? -1 : 1;
  return { [field]: dir, _id: dir };
}

export function applyPeriodPatches(
  base: ElectricBillPeriod[],
  patches: PeriodPatch | undefined
): ElectricBillPeriod[] {
  if (!patches?.length) return base;
  const next = base.map((p) => ({ ...p }));

  for (const patch of patches) {
    const idx = next.findIndex((p) => p.ky === patch.ky);
    if (idx < 0) continue;

    const cur = { ...next[idx] };
    if (patch.amount !== undefined) cur.amount = patch.amount;
    if (patch.paymentDeadline !== undefined) cur.paymentDeadline = patch.paymentDeadline;
    if (patch.scanDate !== undefined) cur.scanDate = patch.scanDate;
    if (patch.scanDdMm !== undefined) {
      const raw = patch.scanDdMm;
      cur.scanDdMm = raw == null || !String(raw).trim() ? null : normalizeScanDdMmInput(String(raw).trim());
    }
    if (patch.ca !== undefined) cur.ca = patch.ca;
    if (patch.assignedAgencyId !== undefined) cur.assignedAgencyId = patch.assignedAgencyId;
    if (patch.assignedAgencyName !== undefined) cur.assignedAgencyName = patch.assignedAgencyName;
    if (patch.dlGiaoName !== undefined) cur.dlGiaoName = patch.dlGiaoName;
    if (patch.paymentConfirmed !== undefined) cur.paymentConfirmed = patch.paymentConfirmed;
    if (patch.cccdConfirmed !== undefined) cur.cccdConfirmed = patch.cccdConfirmed;
    if (patch.customerName !== undefined) cur.customerName = patch.customerName;
    if (patch.cardType !== undefined) cur.cardType = patch.cardType;
    if (patch.dealCompletedAt !== undefined) cur.dealCompletedAt = patch.dealCompletedAt;

    next[idx] = cur;
  }

  return next;
}

export type BillLevelSyncDoc = mongoose.Document & {
  assignedAgencyId?: string | null;
  assignedAgencyName?: string | null;
  assignedAt?: Date | null;
  customerName?: string | null;
  paymentConfirmed?: boolean;
  cccdConfirmed?: boolean;
  cardType?: string | null;
  dealCompletedAt?: Date | null;
};

export function syncBillLevelFromPeriods(
  doc: BillLevelSyncDoc,
  periods: ElectricBillPeriod[]
) {
  let withAg = periods.filter((p) => p.amount != null && p.assignedAgencyId?.trim());
  if (withAg.length === 0) withAg = periods.filter((p) => p.assignedAgencyId?.trim());

  if (withAg.length === 0) {
    doc.set("assignedAgencyId", undefined);
    doc.set("assignedAgencyName", undefined);
    doc.set("assignedAt", undefined);
  } else {
    const sorted = [...withAg].sort((a, b) => a.ky - b.ky);
    const p0 = sorted[0];
    doc.set("assignedAgencyId", p0.assignedAgencyId ?? undefined);
    doc.set("assignedAgencyName", p0.assignedAgencyName ?? undefined);
  }

  const ref =
    [...periods].sort((a, b) => a.ky - b.ky).find((p) => p.amount != null) ??
    periods.find((p) => p.ky === 1);

  if (ref?.customerName != null) doc.set("customerName", ref.customerName || undefined);
  if (ref) {
    doc.set("paymentConfirmed", ref.paymentConfirmed);
    doc.set("cccdConfirmed", ref.cccdConfirmed);
    doc.set("cardType", ref.cardType ?? undefined);
  }

  const allDone = periods.every((p) => p.amount == null || Boolean(p.dealCompletedAt));
  if (allDone) {
    doc.set("dealCompletedAt", new Date());
  } else {
    doc.set("dealCompletedAt", undefined);
  }
}