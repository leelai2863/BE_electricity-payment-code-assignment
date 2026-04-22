import mongoose from "mongoose";
import { escapeRegex } from "@/modules/electric-bills/electric-bills.helpers";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import { AssignedCode } from "@/models/AssignedCode";
import { VoucherCode } from "@/models/VoucherCode";
import { RefundFeeRule } from "@/models/RefundFeeRule";
import { RefundLineState } from "@/models/RefundLineState";
import { SplitBillEntry } from "@/models/SplitBillEntry";

export const INVOICE_LIST_PROJECTION = {
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

export async function findUnassignedCandidateBills() {
  return ElectricBillRecord.find({
    $or: [{ dealCompletedAt: null }, { dealCompletedAt: { $exists: false } }],
  })
    .sort({ customerCode: 1 })
    .limit(2000)
    .lean();
}

export async function countInvoiceList(match: Record<string, unknown>) {
  return ElectricBillRecord.countDocuments(match).exec();
}

export async function findInvoiceListDocs(params: {
  match: Record<string, unknown>;
  sort: Record<string, 1 | -1>;
  skip: number;
  limit: number;
}) {
  return ElectricBillRecord.find(params.match, INVOICE_LIST_PROJECTION)
    .sort(params.sort)
    .skip(params.skip)
    .limit(params.limit)
    .lean()
    .exec();
}

export async function aggregateInvoiceFacets(match: Record<string, unknown>) {
  return ElectricBillRecord.aggregate([
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
}

export async function findBillsLean(
  filter: Record<string, unknown> = {},
  sort: Record<string, 1 | -1> = { customerCode: 1 },
  limit = 5000
) {
  return ElectricBillRecord.find(filter).sort(sort).limit(limit).lean();
}

export async function findBillsByYearMonth(year: number, month: number) {
  return ElectricBillRecord.find({ year, month }).sort({ customerCode: 1 }).limit(5000).lean();
}

export async function findMailQueueBills() {
  return ElectricBillRecord.find({}).limit(3000).lean();
}

export async function findRefundLineStates() {
  return RefundLineState.find({}).limit(15000).lean();
}

export async function findRefundFeeRules(filter: Record<string, unknown> = {}) {
  return RefundFeeRule.find(filter)
    .sort({ agencyName: 1, effectiveFrom: -1, createdAt: -1 })
    .limit(10000)
    .lean();
}

export async function createRefundFeeRuleDoc(data: {
  agencyName: string;
  feeName?: string;
  statusLabel: string;
  conditionType?: "amount" | "cardType" | "manual" | "fixed" | "advance" | "wait";
  amountMin?: number | null;
  amountMax?: number | null;
  cardType?: string | null;
  pct: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  isActive?: boolean;
}) {
  return RefundFeeRule.create(data);
}

export async function findRefundFeeRuleById(id: string) {
  return RefundFeeRule.findById(id).exec();
}

export async function updateRefundFeeRuleById(
  id: string,
  data: {
    feeName?: string;
    statusLabel?: string;
    conditionType?: "amount" | "cardType" | "manual" | "fixed" | "advance" | "wait";
    amountMin?: number | null;
    amountMax?: number | null;
    cardType?: string | null;
    pct?: number;
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
    isActive?: boolean;
  }
) {
  return RefundFeeRule.findByIdAndUpdate(id, { $set: data }, { new: true }).exec();
}

export async function deleteRefundFeeRuleById(id: string) {
  return RefundFeeRule.findByIdAndDelete(id).exec();
}

export async function findRefundLineStateOne(billId: string, ky: number, splitPart: 0 | 1 | 2 = 0) {
  return RefundLineState.findOne({ billId, ky, splitPart }).lean();
}

export async function upsertRefundLineStateDoc(
  billId: string,
  ky: number,
  data: {
    agencyName: string;
    status: string;
    phiPct: number | null;
    daHoan: number;
  },
  splitPart: 0 | 1 | 2 = 0
) {
  return RefundLineState.findOneAndUpdate(
    { billId, ky, splitPart },
    { $set: { ...data, splitPart } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
}

export async function findAssignedCodeOne(params: {
  customerCode: string;
  amount: number;
  year: number;
  month: number;
}) {
  return AssignedCode.findOne(params).lean();
}

export async function upsertAssignedCodeDoc(params: {
  customerCode: string;
  amount: number;
  year: number;
  month: number;
  agencyId: string;
  agencyName: string;
  billId: string;
  ky: 1 | 2 | 3;
}) {
  return AssignedCode.findOneAndUpdate(
    {
      customerCode: params.customerCode,
      amount: params.amount,
      year: params.year,
      month: params.month,
    },
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

export async function deleteAssignedCodeDoc(
  customerCode: string,
  amount: number,
  year: number,
  month: number
) {
  return AssignedCode.deleteOne({ customerCode, amount, year, month });
}

export async function findAssignedCodesList(filter: Record<string, unknown>) {
  return AssignedCode.find(filter).sort({ assignedAt: -1 }).limit(5000).lean();
}

export async function findElectricBillById(id: string) {
  return ElectricBillRecord.findById(id).exec();
}

export async function findElectricBillByCustomerYearMonth(customerCode: string, year: number, month: number) {
  const code = customerCode.trim();
  if (!code) return null;
  return ElectricBillRecord.findOne({
    year,
    month,
    customerCode: { $regex: new RegExp(`^${escapeRegex(code)}$`, "i") },
  })
    .select("_id")
    .lean();
}

export async function assignElectricBillIfAvailable(params: {
  billId: string;
  agencyId: string;
  agencyName: string;
  assignedAt: Date;
  periods: unknown;
}) {
  return ElectricBillRecord.findOneAndUpdate(
    {
      _id: params.billId,
      $or: [{ assignedAgencyId: null }, { assignedAgencyId: { $exists: false } }],
    },
    {
      $set: {
        assignedAgencyId: params.agencyId,
        assignedAgencyName: params.agencyName,
        assignedAt: params.assignedAt,
        periods: params.periods,
      },
    },
    { new: true }
  ).lean();
}

export async function markVoucherCodeCompleted(code: string) {
  return VoucherCode.findOneAndUpdate({ code }, { $set: { status: 3 } });
}

export function newObjectId(value?: string) {
  return value && mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(value)
    : new mongoose.Types.ObjectId();
}

// ─── Mã treo (Pending bills) ────────────────────────────────────────────────

export async function findPendingBills() {
  return ElectricBillRecord.find({ isPending: true })
    .sort({ pendingAt: -1 })
    .limit(2000)
    .lean();
}

export async function setPendingBill(id: string, note?: string) {
  return ElectricBillRecord.findByIdAndUpdate(
    id,
    {
      $set: {
        isPending: true,
        pendingAt: new Date(),
        pendingNote: note ?? null,
        pendingResolvedAt: null,
      },
    },
    { new: true }
  ).lean();
}

export async function resolvePendingBill(id: string) {
  return ElectricBillRecord.findByIdAndUpdate(
    id,
    { $set: { isPending: false, pendingResolvedAt: new Date() } },
    { new: true }
  ).lean();
}

export async function updatePendingBillImages(
  id: string,
  updates: { pendingBillImagePath?: string | null; pendingCccdImagePath?: string | null }
) {
  return ElectricBillRecord.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
}

// ─── Split bills (Hạ cước) ──────────────────────────────────────────────────

type SplitPeriodData = {
  amount: number;
};

export async function createSplitBillEntry(data: {
  originalBillId: string;
  originalKy: 1 | 2 | 3;
  customerCode: string;
  monthLabel: string;
  month: number;
  year: number;
  originalAmount: number;
  split1: SplitPeriodData;
  split2: SplitPeriodData;
}) {
  return SplitBillEntry.create({ ...data, status: "active" });
}

export async function findActiveSplitsByBillIds(billIds: string[]) {
  if (billIds.length === 0) return [];
  return SplitBillEntry.find({ originalBillId: { $in: billIds }, status: "active" }).lean();
}

export async function findSplitBillEntryById(splitId: string) {
  if (!mongoose.isValidObjectId(splitId)) return null;
  return SplitBillEntry.findById(splitId).exec();
}

export async function patchSplitPeriodFields(
  splitId: string,
  splitIdx: 1 | 2,
  changes: Record<string, unknown>
) {
  const prefix = splitIdx === 1 ? "split1" : "split2";
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) {
    update[`${prefix}.${k}`] = v;
  }
  return SplitBillEntry.findByIdAndUpdate(splitId, { $set: update }, { new: true }).exec();
}

export async function resolveSplitBillEntry(splitId: string) {
  return SplitBillEntry.findByIdAndUpdate(
    splitId,
    { $set: { status: "resolved", resolvedAt: new Date() } },
    { new: true }
  ).exec();
}

export async function cancelSplitBillEntry(splitId: string) {
  return SplitBillEntry.findByIdAndUpdate(
    splitId,
    { $set: { status: "cancelled", resolvedAt: new Date() } },
    { new: true }
  ).exec();
}

export async function findActiveSplitsByOriginalBill(originalBillId: string) {
  return SplitBillEntry.find({ originalBillId, status: "active" }).lean();
}

/** Các tách mã đã kết thúc — dùng tạo dòng Hoàn tiền cho 2 mã con */
export async function findResolvedSplitEntriesForQueue(limit = 5000) {
  return SplitBillEntry.find({ status: "resolved" })
    .sort({ resolvedAt: -1 })
    .limit(limit)
    .lean();
}

let refundLineStateIndexMigrated = false;
/** Một lần: bỏ index cũ billId+ky, gán splitPart:0, sync index mới */
export async function ensureRefundLineStateSplitPartIndex() {
  if (refundLineStateIndexMigrated) return;
  try {
    await RefundLineState.collection.dropIndex("billId_1_ky_1");
  } catch {
    // index không tồn tại hoặc đã đổi tên
  }
  await RefundLineState.updateMany(
    { $or: [{ splitPart: { $exists: false } }, { splitPart: null }] },
    { $set: { splitPart: 0 } }
  );
  await RefundLineState.syncIndexes();
  refundLineStateIndexMigrated = true;
}