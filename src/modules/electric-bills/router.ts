import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { writeAuditLog } from "@/lib/audit";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import { AssignedCode } from "../../models/AssignedCode";
import { VoucherCode } from "@/models/VoucherCode";
import { serializeElectricBill, billHasIncompletePeriod } from "@/lib/electric-bill-serialize";
import { isPeriodReadyForDealCompletion } from "@/lib/electric-bill-completion";
import { periodsDtoToMongoSchema } from "@/lib/electric-bill-mongo-periods";
import { normalizeScanDdMmInput, scanDdMmIsNotFuture } from "@/lib/scan-ddmm";
import type {
  ElectricBillDto,
  ElectricBillPeriod,
  MailQueueLineDto,
  RefundFeeRuleDto,
  RefundLineStateDto,
} from "@/types/electric-bill";
import { RefundFeeRule } from "@/models/RefundFeeRule";
import { RefundLineState } from "@/models/RefundLineState";
import { resolveRefundFeePctFromLine } from "@/lib/refund-fee-resolve";

const router = Router();

// --- Bộ lọc theo tổng tiền ---

type AmountFilter = "lt30" | "lt70" | "lt100" | "lt300" | "lte500" | "gt500";
const VALID_AMOUNT_FILTERS = new Set<string>(["lt30", "lt70", "lt100", "lt300", "lte500", "gt500"]);
const M = 1_000_000;

function billTotalAmount(bill: ElectricBillDto): number {
  return bill.periods.reduce((sum, p) => sum + (p.amount ?? 0), 0);
}

function passesAmountFilter(total: number, filter: AmountFilter): boolean {
  switch (filter) {
    case "lt30":   return total < 30 * M;
    case "lt70":   return total >= 30 * M  && total < 70 * M;
    case "lt100":  return total >= 70 * M  && total < 100 * M;
    case "lt300":  return total >= 100 * M && total < 300 * M;
    case "lte500": return total >= 300 * M && total <= 500 * M;
    case "gt500":  return total > 500 * M;
  }
}

function completedAmountPeriods(periods: ElectricBillPeriod[]): ElectricBillPeriod[] {
  return periods.filter((p) => p.amount != null && Boolean(p.dealCompletedAt));
}

type InvoiceSortBy =
  | "customerCode"
  | "evn"
  | "month"
  | "year"
  | "assignedAt"
  | "updatedAt"
  | "createdAt"
  | "_id";
type SortDir = "asc" | "desc";

type InvoiceListParams = {
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

const INVOICE_LIST_PROJECTION = {
  customerCode: 1,
  month: 1,
  year: 1,
  monthLabel: 1,
  evn: 1,
  company: 1,
  assignedAgencyId: 1,
  assignedAgencyName: 1,
  assignedAt: 1,
  customerName: 1,
  paymentConfirmed: 1,
  cccdConfirmed: 1,
  cardType: 1,
  dealCompletedAt: 1,
  periods: 1,
  updatedAt: 1,
  createdAt: 1,
} as const;

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

function toBool(raw: unknown): boolean | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

function toPositiveInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function parseInvoiceListParams(req: Request): InvoiceListParams {
  const page = toPositiveInt(req.query.page, 1);
  const pageSize = Math.min(500, toPositiveInt(req.query.pageSize, 100));
  const monthRaw = Number(req.query.month);
  const yearRaw = Number(req.query.year);
  const done = toBool(req.query.done);
  const includeArchived = toBool(req.query.includeArchived) ?? false;
  const includeFacets = toBool(req.query.includeFacets) ?? false;
  const updatedAfterRaw = typeof req.query.updatedAfter === "string" ? req.query.updatedAfter : undefined;
  const updatedAfter = updatedAfterRaw ? new Date(updatedAfterRaw) : undefined;
  const sortDir = (String(req.query.sortDir ?? "asc").toLowerCase() === "desc" ? "desc" : "asc") as SortDir;
  const sortByRaw = String(req.query.sortBy ?? "customerCode") as InvoiceSortBy;
  const sortBy: InvoiceSortBy = INVOICE_SORT_FIELD_MAP[sortByRaw] ? sortByRaw : "customerCode";
  const cursor = typeof req.query.cursor === "string" && mongoose.isValidObjectId(req.query.cursor)
    ? req.query.cursor
    : undefined;

  return {
    page,
    pageSize,
    customerCode: typeof req.query.customerCode === "string" ? req.query.customerCode.trim() : undefined,
    evn: typeof req.query.evn === "string" ? req.query.evn.trim() : undefined,
    assignedAgencyName:
      typeof req.query.assignedAgencyName === "string" ? req.query.assignedAgencyName.trim() : undefined,
    scanDdMm: typeof req.query.scanDdMm === "string" ? req.query.scanDdMm.trim() : undefined,
    paymentDeadline: typeof req.query.paymentDeadline === "string" ? req.query.paymentDeadline.trim() : undefined,
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

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildInvoiceListMatch(params: InvoiceListParams): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (params.customerCode) and.push({ customerCode: { $regex: escapeRegex(params.customerCode), $options: "i" } });
  if (params.evn) and.push({ evn: { $regex: escapeRegex(params.evn), $options: "i" } });
  if (params.assignedAgencyName) {
    and.push({
      periods: {
        $elemMatch: {
          assignedAgencyName: { $regex: escapeRegex(params.assignedAgencyName), $options: "i" },
        },
      },
    });
  }
  if (params.scanDdMm) and.push({ periods: { $elemMatch: { scanDdMm: params.scanDdMm } } });
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
    and.push({
      periods: { $elemMatch: { amount: { $ne: null } } },
    });
    and.push({
      periods: { $not: { $elemMatch: { amount: { $ne: null }, dealCompletedAt: null } } },
    });
  } else if (params.done === false || !params.includeArchived) {
    and.push({
      periods: { $elemMatch: { amount: { $ne: null }, dealCompletedAt: null } },
    });
  }
  return and.length > 0 ? { $and: and } : {};
}

function invoiceListSort(sortBy: InvoiceSortBy, sortDir: SortDir): Record<string, 1 | -1> {
  const field = INVOICE_SORT_FIELD_MAP[sortBy] ?? "customerCode";
  const dir: 1 | -1 = sortDir === "desc" ? -1 : 1;
  return { [field]: dir, _id: dir };
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

type PeriodPatch = (Partial<Omit<ElectricBillPeriod, "ky">> & { ky: 1 | 2 | 3 })[];

type PatchBody = {
  customerName?: string | null;
  paymentConfirmed?: boolean;
  cccdConfirmed?: boolean;
  cardType?: string | null;
  assignedAgencyId?: string | null;
  assignedAgencyName?: string | null;
  assignedAt?: string | null;
  dealCompletedAt?: string | null;
  periods?: PeriodPatch;
  actorUserId?: string;
};

function applyPeriodPatches(base: ElectricBillPeriod[], patches: PeriodPatch | undefined): ElectricBillPeriod[] {
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
      cur.scanDdMm =
        raw == null || !String(raw).trim() ? null : normalizeScanDdMmInput(String(raw).trim());
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

function syncBillLevelFromPeriods(
  doc: mongoose.Document & {
    assignedAgencyId?: string | null;
    assignedAgencyName?: string | null;
    assignedAt?: Date | null;
    customerName?: string | null;
    paymentConfirmed?: boolean;
    cccdConfirmed?: boolean;
    cardType?: string | null;
    dealCompletedAt?: Date | null;
  },
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
    [...periods].sort((a, b) => a.ky - b.ky).find((p) => p.amount != null) ?? periods.find((p) => p.ky === 1);
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

// --- Tiện ích AssignedCode ---

/**
 * Kiểm tra (customerCode, amount, year, month) đã được giao cho đại lý khác chưa.
 * Ràng buộc theo tháng: tháng khác nhau có thể giao cho đại lý khác nhau.
 * Trả về tên đại lý đang giữ chỗ nếu có xung đột, null nếu được phép tiếp tục.
 */
async function checkAssignedCodeConflict(
  customerCode: string,
  amount: number,
  year: number,
  month: number,
  incomingAgencyId: string
): Promise<string | null> {
  const existing = await AssignedCode.findOne({ customerCode, amount, year, month }).lean();
  if (!existing) return null;
  if (existing.agencyId === incomingAgencyId) return null; // cùng đại lý → OK
  return existing.agencyName; // khác đại lý trong cùng tháng → xung đột
}

/**
 * Lưu/cập nhật bản ghi "đã giao" cho (customerCode, amount, year, month).
 * Dùng upsert để gọi lặp an toàn (nhiều lần không gây lỗi).
 */
async function upsertAssignedCode(params: {
  customerCode: string;
  amount: number;
  year: number;
  month: number;
  agencyId: string;
  agencyName: string;
  billId: string;
  ky: 1 | 2 | 3;
}) {
  await AssignedCode.findOneAndUpdate(
    { customerCode: params.customerCode, amount: params.amount, year: params.year, month: params.month },
    {
      $set: {
        agencyId: params.agencyId,
        agencyName: params.agencyName,
        billId: params.billId,
        ky: params.ky,
        assignedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Xóa bản ghi "đã giao" khi hủy giao mã (nhấn X).
 */
async function deleteAssignedCode(
  customerCode: string,
  amount: number,
  year: number,
  month: number
): Promise<void> {
  await AssignedCode.deleteOne({ customerCode, amount, year, month });
}

/** GET /api/electric-bills/unassigned?amountFilter=lt30|lt70|lt100|lt300|lte500|gt500 */
router.get("/unassigned", async (req: Request, res: Response) => {
  const rawAmountFilter = typeof req.query.amountFilter === "string" ? req.query.amountFilter : null;
  const amountFilter: AmountFilter | null =
    rawAmountFilter && VALID_AMOUNT_FILTERS.has(rawAmountFilter)
      ? (rawAmountFilter as AmountFilter)
      : null;

  try {
    await connectDB();
    const docs = await ElectricBillRecord.find({
      $or: [{ dealCompletedAt: null }, { dealCompletedAt: { $exists: false } }],
    })
      .sort({ customerCode: 1 })
      .limit(2000)
      .lean();

    let data = docs
      .map((d) => serializeElectricBill(d as Record<string, unknown>))
      .filter((bill) =>
        bill.periods.some((p) => p.amount != null && (!p.assignedAgencyId || !p.assignedAgencyId.trim()))
      );

    if (amountFilter) {
      data = data.filter((bill) => passesAmountFilter(billTotalAmount(bill), amountFilter));
    }

    res.json({ data, source: "mongodb", amountFilter });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
    res.status(503).json({ error: message, data: [] });
  }
});

/** GET /api/electric-bills/invoice-list */
router.get("/invoice-list", async (req: Request, res: Response) => {
  const params = parseInvoiceListParams(req);
  const match = buildInvoiceListMatch(params);
  const sort = invoiceListSort(params.sortBy, params.sortDir);
  const dbStarted = nowMs();
  try {
    await connectDB();

    // Cursor mode (optimized for incremental scrolling) when sort by _id.
    const cursorMatch: Record<string, unknown> = { ...match };
    if (params.cursor && params.sortBy === "_id") {
      const dir = params.sortDir === "desc" ? "$lt" : "$gt";
      const cursorAnd = (cursorMatch.$and as Record<string, unknown>[] | undefined) ?? [];
      cursorAnd.push({ _id: { [dir]: new mongoose.Types.ObjectId(params.cursor) } });
      cursorMatch.$and = cursorAnd;
    }

    const totalPromise = ElectricBillRecord.countDocuments(match).exec();
    const docsPromise = ElectricBillRecord.find(cursorMatch, INVOICE_LIST_PROJECTION)
      .sort(sort)
      .skip(params.cursor ? 0 : (params.page - 1) * params.pageSize)
      .limit(params.pageSize + 1)
      .lean()
      .exec();

    const [total, docsRaw] = await Promise.all([totalPromise, docsPromise]);
    const dbQueryMs = nowMs() - dbStarted;

    const hasNext = docsRaw.length > params.pageSize;
    const docs = hasNext ? docsRaw.slice(0, params.pageSize) : docsRaw;
    const serializeStarted = nowMs();
    const items = docs.map((d) => serializeElectricBill(d as Record<string, unknown>));
    const serializeMs = nowMs() - serializeStarted;
    const nextCursor = hasNext ? String(docs[docs.length - 1]?._id ?? "") : null;

    let aggregations: Record<string, unknown> = {
      total,
      incomplete: items.filter(billHasIncompletePeriod).length,
      months: [...new Set(items.map((x) => `${x.year}-${x.month}`))].length,
    };

    if (params.includeFacets) {
      const facetsStarted = nowMs();
      const facetRows = await ElectricBillRecord.aggregate([
        { $match: match },
        { $project: { customerCode: 1, evn: 1, month: 1, year: 1, periods: 1 } },
        { $unwind: "$periods" },
        {
          $group: {
            _id: null,
            customerCodes: { $addToSet: "$customerCode" },
            evns: { $addToSet: "$evn" },
            months: { $addToSet: "$month" },
            years: { $addToSet: "$year" },
            assignedAgencyNames: { $addToSet: "$periods.assignedAgencyName" },
            scanDdMms: { $addToSet: "$periods.scanDdMm" },
          },
        },
        { $project: { _id: 0 } },
      ]).exec();
      const facets = facetRows[0] ?? {};
      aggregations = {
        ...aggregations,
        facets: {
          customerCode: (facets.customerCodes ?? []).filter(Boolean).slice(0, 500),
          evn: (facets.evns ?? []).filter(Boolean).slice(0, 200),
          assignedAgencyName: (facets.assignedAgencyNames ?? []).filter(Boolean).slice(0, 500),
          scanDdMm: (facets.scanDdMms ?? []).filter(Boolean).slice(0, 500),
          month: (facets.months ?? []).filter((x: unknown) => Number.isInteger(Number(x))).sort((a: number, b: number) => a - b),
          year: (facets.years ?? []).filter((x: unknown) => Number.isInteger(Number(x))).sort((a: number, b: number) => a - b),
        },
        facetsMs: Math.round(nowMs() - facetsStarted),
      };
    }

    const payload = {
      items,
      // backward-compatible key for existing FE
      data: items,
      total,
      hasNext,
      nextCursor,
      page: params.page,
      pageSize: params.pageSize,
      aggregations,
      source: "mongodb",
      query: {
        includeArchived: params.includeArchived,
        done: params.done,
        sortBy: params.sortBy,
        sortDir: params.sortDir,
        updatedAfter: params.updatedAfter?.toISOString() ?? null,
      },
      metrics: {
        dbQueryMs: Math.round(dbQueryMs),
        serializeMs: Math.round(serializeMs),
        responseBytes: 0,
      },
    };
    const responseBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    payload.metrics.responseBytes = responseBytes;
    console.info("[electric-bills.invoice-list]", {
      total,
      returned: items.length,
      hasNext,
      dbQueryMs: payload.metrics.dbQueryMs,
      serializeMs: payload.metrics.serializeMs,
      responseBytes,
    });
    res.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
    res.status(503).json({
      error: message,
      items: [],
      data: [],
      total: 0,
      hasNext: false,
      nextCursor: null,
      page: params.page,
      pageSize: params.pageSize,
      aggregations: {},
    });
  }
});


/** GET /api/electric-bills/invoice-completed-months — các (năm, tháng) có ít nhất một cặp mã+số tiền đã xác nhận */
router.get("/invoice-completed-months", async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const docs = await ElectricBillRecord.find({}).sort({ year: -1, month: -1 }).limit(5000).lean();
    const seen = new Map<string, { year: number; month: number }>();
    for (const d of docs) {
      const bill = serializeElectricBill(d as Record<string, unknown>);
      if (completedAmountPeriods(bill.periods).length === 0) continue;
      const k = `${bill.year}-${bill.month}`;
      if (!seen.has(k)) seen.set(k, { year: bill.year, month: bill.month });
    }
    const data = [...seen.values()].sort((a, b) => b.year - a.year || b.month - a.month);
    res.json({
      data: data.map(({ year, month }) => ({ year, month, label: `T${month}/${year}` })),
      source: "mongodb",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
    res.status(503).json({ error: message, data: [] });
  }
});

/** GET /api/electric-bills/invoice-completed?year=&month= — hóa đơn có ít nhất một cặp mã+số tiền đã xác nhận trong tháng */
router.get("/invoice-completed", async (req: Request, res: Response) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: "Tham số year và month (1–12) là bắt buộc", data: [] });
    return;
  }
  try {
    await connectDB();
    const docs = await ElectricBillRecord.find({ year, month }).sort({ customerCode: 1 }).limit(5000).lean();
    const data = docs
      .map((d) => serializeElectricBill(d as Record<string, unknown>))
      .map((bill) => ({ ...bill, periods: completedAmountPeriods(bill.periods) }))
      .filter((bill) => bill.periods.length > 0);
    res.json({ data, source: "mongodb" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
    res.status(503).json({ error: message, data: [] });
  }
});
function serializeRefundLineStateDoc(
  doc: {
    billId: string;
    ky: number;
    agencyName: string;
    status?: string;
    phiPct?: number | null;
    daHoan?: number;
    updatedAt?: Date;
  }
): RefundLineStateDto {
  return {
    billId: doc.billId,
    ky: doc.ky as 1 | 2 | 3,
    agencyName: doc.agencyName,
    status: doc.status ?? "",
    phiPct: doc.phiPct === undefined || doc.phiPct === null ? null : doc.phiPct,
    daHoan: typeof doc.daHoan === "number" ? doc.daHoan : 0,
    updatedAt:
      doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date().toISOString(),
  };
}

function serializeRefundFeeRuleDoc(doc: {
  _id: mongoose.Types.ObjectId;
  agencyName: string;
  statusLabel: string;
  pct: number;
  effectiveFrom: Date;
}): RefundFeeRuleDto {
  return {
    _id: String(doc._id),
    agencyName: doc.agencyName,
    statusLabel: doc.statusLabel,
    pct: doc.pct,
    effectiveFrom: doc.effectiveFrom instanceof Date ? doc.effectiveFrom.toISOString() : String(doc.effectiveFrom),
  };
}

/** GET /api/electric-bills/mail-queue — kèm refundLineStates + refundFeeRules cho trang Hoàn tiền */
router.get("/mail-queue", async (_req: Request, res: Response) => {
  try {
    await connectDB();
    const [docs, lineStateDocs, feeRuleDocs] = await Promise.all([
      ElectricBillRecord.find({}).limit(3000).lean(),
      RefundLineState.find({}).limit(15000).lean(),
      RefundFeeRule.find({}).sort({ agencyName: 1, statusLabel: 1, effectiveFrom: -1 }).limit(5000).lean(),
    ]);
    const lines: MailQueueLineDto[] = [];
    for (const d of docs) {
      const bill = serializeElectricBill(d as Record<string, unknown>);
      for (const p of bill.periods) {
        if (!p.dealCompletedAt || p.amount == null) continue;
        lines.push({
          billId: bill._id,
          customerCode: bill.customerCode,
          monthLabel: bill.monthLabel,
          month: bill.month,
          year: bill.year,
          evn: bill.evn,
          company: bill.company,
          ky: p.ky,
          amount: p.amount,
          assignedAgencyName: p.assignedAgencyName,
          ca: p.ca,
          dlGiaoName: p.dlGiaoName,
          customerName: p.customerName,
          scanDdMm: p.scanDdMm,
          dealCompletedAt: p.dealCompletedAt,
        });
      }
    }
    lines.sort((a, b) => new Date(b.dealCompletedAt).getTime() - new Date(a.dealCompletedAt).getTime());
    const refundLineStates: RefundLineStateDto[] = lineStateDocs.map((x) => serializeRefundLineStateDoc(x));
    const refundFeeRules: RefundFeeRuleDto[] = feeRuleDocs.map((x) => serializeRefundFeeRuleDoc(x));
    res.json({ data: lines, refundLineStates, refundFeeRules, source: "mongodb" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
    res.status(503).json({ error: message, data: [] });
  }
});

type RefundLinePatchBodyItem = {
  billId: string;
  ky: 1 | 2 | 3;
  agencyName: string;
  year: number;
  month: number;
  scanDdMm: string | null;
  dealCompletedAt: string;
  status?: string;
  daHoan?: number;
  /** Khi đổi trạng thái: giữ đúng % (undo); bỏ qua nếu không gửi — server resolve theo lịch sử phí */
  phiPctOverride?: number | null;
};

/** POST /api/electric-bills/refund-fee-rules — thêm mức phí theo ngày hiệu lực */
router.post("/refund-fee-rules", async (req: Request, res: Response) => {
  const body = req.body as {
    agencyName?: string;
    statusLabel?: string;
    pct?: number;
    effectiveFrom?: string;
  };
  const agencyName = typeof body.agencyName === "string" ? body.agencyName.trim() : "";
  const statusLabel = typeof body.statusLabel === "string" ? body.statusLabel.trim().toUpperCase() : "";
  const pct = typeof body.pct === "number" ? body.pct : Number(body.pct);
  if (!agencyName || !statusLabel || !Number.isFinite(pct)) {
    res.status(400).json({ error: "Cần agencyName, statusLabel và pct hợp lệ" });
    return;
  }
  const effRaw = body.effectiveFrom;
  const effectiveFrom =
    typeof effRaw === "string" && effRaw.trim()
      ? new Date(effRaw)
      : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) {
    res.status(400).json({ error: "effectiveFrom không hợp lệ" });
    return;
  }
  try {
    await connectDB();
    const doc = await RefundFeeRule.create({
      agencyName,
      statusLabel,
      pct,
      effectiveFrom,
    });
    res.status(201).json({ data: serializeRefundFeeRuleDoc(doc.toObject() as Parameters<typeof serializeRefundFeeRuleDoc>[0]) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không lưu được";
    res.status(500).json({ error: message });
  }
});

/** PATCH /api/electric-bills/refund-line-states — cập nhật trạng thái / đã hoàn (snapshot phí khi đổi trạng thái) */
router.patch("/refund-line-states", async (req: Request, res: Response) => {
  const body = req.body as { items?: RefundLinePatchBodyItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    res.status(400).json({ error: "Cần mảng items" });
    return;
  }
  if (items.length > 500) {
    res.status(400).json({ error: "Tối đa 500 dòng mỗi lần" });
    return;
  }
  try {
    await connectDB();
    const out: RefundLineStateDto[] = [];
    for (const it of items) {
      if (!mongoose.isValidObjectId(it.billId)) {
        res.status(400).json({ error: `billId không hợp lệ: ${it.billId}` });
        return;
      }
      const ky = Number(it.ky);
      if (ky !== 1 && ky !== 2 && ky !== 3) {
        res.status(400).json({ error: "ky phải là 1, 2 hoặc 3" });
        return;
      }
      const agencyName = typeof it.agencyName === "string" ? it.agencyName.trim() : "";
      if (!agencyName) {
        res.status(400).json({ error: "Thiếu agencyName" });
        return;
      }
      const year = Number(it.year);
      const month = Number(it.month);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        res.status(400).json({ error: "year/month không hợp lệ" });
        return;
      }
      const anchorInput = {
        year,
        month,
        scanDdMm: it.scanDdMm ?? null,
        dealCompletedAt: typeof it.dealCompletedAt === "string" ? it.dealCompletedAt : "",
      };
      const existing = await RefundLineState.findOne({ billId: it.billId, ky }).lean();
      const curStatus = (existing?.status ?? "") as string;
      const curPhi = (existing?.phiPct ?? null) as number | null;
      const curDaHoan = typeof existing?.daHoan === "number" ? existing.daHoan : 0;

      const statusProvided = it.status !== undefined;
      const newStatus = statusProvided ? String(it.status).trim().toUpperCase() : curStatus;
      const newDaHoan = it.daHoan !== undefined ? (Number(it.daHoan) || 0) : curDaHoan;
      const overrideProvided = it.phiPctOverride !== undefined;

      let newPhi: number | null = curPhi;
      if (statusProvided) {
        if (!newStatus) {
          newPhi = null;
        } else if (overrideProvided) {
          const o = it.phiPctOverride;
          newPhi = o === null || o === undefined ? null : Number(o);
          if (newPhi !== null && !Number.isFinite(newPhi)) newPhi = null;
        } else {
          newPhi = await resolveRefundFeePctFromLine(agencyName, newStatus, anchorInput);
        }
      }

      const doc = await RefundLineState.findOneAndUpdate(
        { billId: it.billId, ky },
        {
          $set: {
            agencyName,
            status: newStatus,
            phiPct: newPhi,
            daHoan: newDaHoan,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).exec();
      if (doc) out.push(serializeRefundLineStateDoc(doc.toObject()));
    }
    res.json({ data: { items: out }, source: "mongodb" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Cập nhật không thành công";
    res.status(500).json({ error: message });
  }
});

/** POST /api/electric-bills/refund-migrate-localstorage — nhập một lần từ LS trình duyệt */
router.post("/refund-migrate-localstorage", async (req: Request, res: Response) => {
  const body = req.body as {
    feeRules?: Array<{ agencyName: string; statusLabel: string; pct: number; effectiveFrom: string }>;
    lineItems?: RefundLinePatchBodyItem[];
  };
  const feeRulesIn = Array.isArray(body.feeRules) ? body.feeRules : [];
  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  try {
    await connectDB();
    let rulesInserted = 0;
    for (const r of feeRulesIn) {
      const agencyName = String(r.agencyName ?? "").trim();
      const statusLabel = String(r.statusLabel ?? "").trim().toUpperCase();
      const pct = Number(r.pct);
      if (!agencyName || !statusLabel || !Number.isFinite(pct)) continue;
      const eff = r.effectiveFrom ? new Date(r.effectiveFrom) : new Date("2020-01-01T00:00:00.000Z");
      if (Number.isNaN(eff.getTime())) continue;
      await RefundFeeRule.create({ agencyName, statusLabel, pct, effectiveFrom: eff });
      rulesInserted += 1;
    }
    const outStates: RefundLineStateDto[] = [];
    for (const it of lineItems) {
      if (!mongoose.isValidObjectId(it.billId)) continue;
      const ky = Number(it.ky);
      if (ky !== 1 && ky !== 2 && ky !== 3) continue;
      const agencyName = String(it.agencyName ?? "").trim();
      if (!agencyName) continue;
      const year = Number(it.year);
      const month = Number(it.month);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
      const anchorInput = {
        year,
        month,
        scanDdMm: it.scanDdMm ?? null,
        dealCompletedAt: typeof it.dealCompletedAt === "string" ? it.dealCompletedAt : "",
      };
      const newStatus = String(it.status ?? "").trim().toUpperCase();
      const newDaHoan = Number(it.daHoan) || 0;
      let newPhi: number | null = null;
      if (newStatus) {
        newPhi = await resolveRefundFeePctFromLine(agencyName, newStatus, anchorInput);
      }
      const doc = await RefundLineState.findOneAndUpdate(
        { billId: it.billId, ky },
        { $set: { agencyName, status: newStatus, phiPct: newPhi, daHoan: newDaHoan } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).exec();
      if (doc) outStates.push(serializeRefundLineStateDoc(doc.toObject()));
    }
    res.json({
      data: { rulesInserted, lineStatesUpserted: outStates.length, lineStates: outStates },
      source: "mongodb",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Migrate không thành công";
    res.status(500).json({ error: message });
  }
});

/** GET /api/electric-bills/assigned-codes?agencyId=&customerCode= */
router.get("/assigned-codes", async (req: Request, res: Response) => {
  const agencyId = typeof req.query.agencyId === "string" ? req.query.agencyId.trim() : null;
  const customerCode = typeof req.query.customerCode === "string" ? req.query.customerCode.trim() : null;

  try {
    await connectDB();
    const filter: Record<string, unknown> = {};
    if (agencyId) filter.agencyId = agencyId;
    if (customerCode) filter.customerCode = customerCode;

    const docs = await AssignedCode.find(filter).sort({ assignedAt: -1 }).limit(5000).lean();
    res.json({ data: docs, total: docs.length, source: "mongodb" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
    res.status(503).json({ error: message, data: [] });
  }
});

/** POST /api/electric-bills/assign */
router.post("/assign", async (req: Request, res: Response) => {
  const body = req.body as {
    billId: string;
    agencyId: string;
    agencyName: string;
    actorUserId?: string;
  };

  if (!body.billId || !body.agencyId || !body.agencyName) {
    res.status(400).json({ error: "Cần có billId, agencyId và agencyName" });
    return;
  }

  if (!mongoose.isValidObjectId(body.billId)) {
    res.status(400).json({ error: "billId phải là _id MongoDB (ObjectId)" });
    return;
  }

  const actorRaw = body.actorUserId;
  const actorId = mongoose.isValidObjectId(actorRaw)
    ? new mongoose.Types.ObjectId(actorRaw)
    : new mongoose.Types.ObjectId();

  try {
    await connectDB();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không kết nối được MongoDB";
    res.status(503).json({ error: message });
    return;
  }

  const doc = await ElectricBillRecord.findById(body.billId).exec();
  if (!doc) {
    res.status(404).json({ error: "Không tìm thấy hóa đơn" });
    return;
  }
  const dto = serializeElectricBill(doc.toObject());

  // Kiểm tra mã + số tiền nào đã bị giao cho đại lý khác trong tháng này chưa
  for (const p of dto.periods) {
    if (p.amount == null) continue;
    const conflict = await checkAssignedCodeConflict(
      doc.customerCode,
      p.amount,
      doc.year,
      doc.month,
      body.agencyId
    );
    if (conflict) {
      res.status(409).json({
        error: `Mã "${doc.customerCode}" số tiền ${p.amount.toLocaleString("vi-VN")}đ tháng ${doc.month}/${doc.year} đã được giao cho đại lý "${conflict}". Không thể giao cho 2 đại lý khác nhau trong cùng tháng.`,
      });
      return;
    }
  }

  const assignedAt = new Date();
  const nextPeriods = dto.periods.map((p) => {
    if (p.amount == null) return { ...p };
    return {
      ...p,
      assignedAgencyId: body.agencyId,
      assignedAgencyName: body.agencyName,
      dlGiaoName: p.dlGiaoName?.trim() ? p.dlGiaoName : body.agencyName,
    };
  });
  const updatedDoc = await ElectricBillRecord.findOneAndUpdate(
    {
      _id: doc._id,
      $or: [{ assignedAgencyId: null }, { assignedAgencyId: { $exists: false } }],
    },
    {
      $set: {
        assignedAgencyId: body.agencyId,
        assignedAgencyName: body.agencyName,
        assignedAt,
        periods: periodsDtoToMongoSchema(nextPeriods),
      },
    },
    { new: true }
  ).lean();
  if (!updatedDoc) {
    res.status(409).json({ error: "Mã đã được giao bởi người khác. Vui lòng tải lại danh sách." });
    return;
  }

  // Ghi vào bảng mã đã giao (theo tháng)
  for (const p of nextPeriods) {
    if (p.amount == null) continue;
    await upsertAssignedCode({
      customerCode: doc.customerCode,
      amount: p.amount,
      year: doc.year,
      month: doc.month,
      agencyId: body.agencyId,
      agencyName: body.agencyName,
      billId: String(doc._id),
      ky: p.ky,
    });
  }

  await writeAuditLog({
    actorUserId: actorId,
    action: "electric.assign_agency",
    entityType: "ElectricBillRecord",
    entityId: doc._id,
    metadata: { agencyId: body.agencyId, agencyName: body.agencyName, customerCode: doc.customerCode },
  });

  res.json({ data: serializeElectricBill(updatedDoc as Record<string, unknown>), source: "mongodb" });
});

/** PATCH /api/electric-bills/:id */
router.patch("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as PatchBody;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ error: "id phải là _id MongoDB (ObjectId)" });
    return;
  }

  const actorRaw = body.actorUserId;
  const actorId = mongoose.isValidObjectId(actorRaw)
    ? new mongoose.Types.ObjectId(actorRaw)
    : new mongoose.Types.ObjectId();

  try {
    await connectDB();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Không kết nối được MongoDB";
    res.status(503).json({ error: message });
    return;
  }

  try {
    const doc = await ElectricBillRecord.findById(id).exec();
    if (!doc) {
      res.status(404).json({ error: "Không tìm thấy bản ghi" });
      return;
    }

    let nextPeriods = serializeElectricBill(doc.toObject()).periods;

    if (body.assignedAgencyId !== undefined && !body.periods?.length) {
      nextPeriods = nextPeriods.map((p) =>
        p.amount == null
          ? p
          : {
              ...p,
              assignedAgencyId: body.assignedAgencyId || null,
              assignedAgencyName: body.assignedAgencyName ?? p.assignedAgencyName,
            }
      );
    }

    if (body.periods?.length) {
      const billCustomerCode = doc.customerCode;
      const billYear = doc.year;
      const billMonth = doc.month;

      for (const patch of body.periods) {
        const cur = nextPeriods.find((p) => p.ky === patch.ky);

        // Hủy giao mã (nút X): assignedAgencyId = null → xóa AssignedCode
        if ((patch.assignedAgencyId === null || patch.assignedAgencyId === "") && cur?.amount != null) {
          await deleteAssignedCode(billCustomerCode, cur.amount, billYear, billMonth);
        }

        // Giao mã mới: kiểm tra xung đột trong cùng tháng
        if (patch.assignedAgencyId && patch.assignedAgencyId.trim()) {
          const amount = patch.amount ?? cur?.amount;
          if (amount != null) {
            const conflict = await checkAssignedCodeConflict(
              billCustomerCode, amount, billYear, billMonth, patch.assignedAgencyId
            );
            if (conflict) {
              res.status(409).json({
                error: `Mã "${billCustomerCode}" số tiền ${amount.toLocaleString("vi-VN")}đ tháng ${billMonth}/${billYear} đã được giao cho đại lý "${conflict}". Không thể giao cho 2 đại lý khác nhau trong cùng tháng.`,
              });
              return;
            }
          }
        }

        if (patch.dealCompletedAt) {
          const trial = applyPeriodPatches(nextPeriods, [patch]);
          const row = trial.find((p) => p.ky === patch.ky);
          if (!row || !isPeriodReadyForDealCompletion({ ...row, dealCompletedAt: null })) {
            res.status(400).json({
              error:
                "Chưa đủ dữ liệu kỳ này (Đại lý, Bill.TT, CCCD, Tên KH, ngày thanh toán dd/mm, CA 10h/16h/24h).",
            });
            return;
          }
        }
      }
      nextPeriods = applyPeriodPatches(nextPeriods, body.periods);

      for (const p of nextPeriods) {
        const raw = p.scanDdMm?.trim();
        if (raw && !scanDdMmIsNotFuture(raw)) {
          res.status(400).json({
            error:
              "Ngày thanh toán (dd/mm) theo năm hiện tại không được sau hôm nay. Xóa và nhập lại ngày hợp lệ.",
          });
          return;
        }
      }

      // Cập nhật bảng đã giao cho các kỳ vừa gán đại lý
      for (const patch of body.periods) {
        if (!patch.assignedAgencyId?.trim()) continue;
        const updated = nextPeriods.find((p) => p.ky === patch.ky);
        if (!updated?.amount || !updated.assignedAgencyName) continue;
        await upsertAssignedCode({
          customerCode: billCustomerCode,
          amount: updated.amount,
          year: billYear,
          month: billMonth,
          agencyId: patch.assignedAgencyId,
          agencyName: updated.assignedAgencyName,
          billId: id,
          ky: patch.ky,
        });
      }
    }

    if (body.assignedAgencyId !== undefined) {
      doc.set("assignedAgencyId", body.assignedAgencyId ?? undefined);
      if (!body.assignedAgencyId) {
        doc.set("assignedAgencyName", undefined);
        doc.set("assignedAt", undefined);
      }
    }
    if (body.assignedAgencyName !== undefined) doc.set("assignedAgencyName", body.assignedAgencyName ?? undefined);
    if (body.assignedAt !== undefined) doc.set("assignedAt", body.assignedAt ? new Date(body.assignedAt) : undefined);
    if (body.customerName !== undefined) doc.set("customerName", body.customerName ?? undefined);
    if (body.paymentConfirmed !== undefined) doc.set("paymentConfirmed", body.paymentConfirmed);
    if (body.cccdConfirmed !== undefined) doc.set("cccdConfirmed", body.cccdConfirmed);
    if (body.cardType !== undefined) doc.set("cardType", body.cardType ?? undefined);

    if (body.dealCompletedAt !== undefined && (body.dealCompletedAt === null || body.dealCompletedAt === "")) {
      doc.set("dealCompletedAt", undefined);
    }

    doc.set("periods", periodsDtoToMongoSchema(nextPeriods) as typeof doc.periods);
    syncBillLevelFromPeriods(doc, nextPeriods);
    doc.markModified("periods");

    await doc.save();

    // Nếu tất cả kỳ có cước đã xác nhận → đánh dấu VoucherCode hoàn tất (status=3)
    const allPeriodsConfirmed = nextPeriods.every((p) => p.amount == null || Boolean(p.dealCompletedAt));
    if (allPeriodsConfirmed) {
      await VoucherCode.findOneAndUpdate(
        { code: doc.customerCode },
        { $set: { status: 3 } }
      );
    }

    await writeAuditLog({
      actorUserId: actorId,
      action: "electric.invoice_patch",
      entityType: "ElectricBillRecord",
      entityId: doc._id,
      metadata: { fields: Object.keys(body) },
    });

    res.json({ data: serializeElectricBill(doc.toObject()), source: "mongodb" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Cập nhật không thành công";
    res.status(500).json({ error: message });
  }
});

export default router;

