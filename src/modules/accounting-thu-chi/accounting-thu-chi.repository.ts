import mongoose from "mongoose";
import { AccountingThuChiEntry } from "@/models/AccountingThuChiEntry";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type AccountingThuChiLean = {
  _id: mongoose.Types.ObjectId;
  txnDate: Date;
  effectivePaymentDate?: Date | null;
  description?: string;
  source?: string;
  bank?: string;
  thu?: number | null;
  chi?: number | null;
  notes?: string;
  linkedAgencyId?: mongoose.Types.ObjectId | null;
  linkedAgencyCode?: string | null;
  linkedAgencyName?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ThuChiListQueryFlow = "all" | "thu" | "chi";
export type ThuChiListQueryLink = "all" | "linked" | "unlinked";

export async function listAccountingThuChiEntries(params: {
  from?: Date;
  to?: Date;
  agencyCode?: string;
  linkedAgencyId?: string;
  /** Tìm trong nội dung, nguồn, ghi chú (không phân biệt hoa thường) */
  textQ?: string;
  /** Tên ngân hàng chứa chuỗi này */
  bankContains?: string;
  flow?: ThuChiListQueryFlow;
  link?: ThuChiListQueryLink;
  skip: number;
  limit: number;
}): Promise<{ items: AccountingThuChiLean[]; total: number }> {
  const clauses: Record<string, unknown>[] = [];
  if (params.from || params.to) {
    const txn: Record<string, Date> = {};
    if (params.from) txn.$gte = params.from;
    if (params.to) txn.$lte = params.to;
    clauses.push({ txnDate: txn });
  }
  if (params.agencyCode?.trim()) {
    clauses.push({ linkedAgencyCode: params.agencyCode.trim().toUpperCase() });
  }
  if (params.linkedAgencyId?.trim()) {
    clauses.push({ linkedAgencyId: new mongoose.Types.ObjectId(params.linkedAgencyId.trim()) });
  }
  if (params.flow === "thu") {
    clauses.push({ thu: { $gt: 0 } });
  } else if (params.flow === "chi") {
    clauses.push({ chi: { $gt: 0 } });
  }
  if (params.link === "linked") {
    clauses.push({ linkedAgencyId: { $ne: null } });
  } else if (params.link === "unlinked") {
    clauses.push({
      $or: [{ linkedAgencyId: null }, { linkedAgencyId: { $exists: false } }],
    });
  }
  const b = params.bankContains?.trim();
  if (b) {
    const rx = new RegExp(escapeRegExp(b), "i");
    clauses.push({ bank: { $regex: rx } });
  }
  const tq = params.textQ?.trim();
  if (tq) {
    const rx = new RegExp(escapeRegExp(tq), "i");
    clauses.push({
      $or: [{ description: { $regex: rx } }, { source: { $regex: rx } }, { notes: { $regex: rx } }],
    });
  }

  const q: Record<string, unknown> = clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0]! : { $and: clauses };

  const [total, items] = await Promise.all([
    AccountingThuChiEntry.countDocuments(q),
    AccountingThuChiEntry.find(q).sort({ txnDate: -1, _id: -1 }).skip(params.skip).limit(params.limit).lean(),
  ]);

  return { items: items as AccountingThuChiLean[], total };
}

export async function findAccountingThuChiById(id: string): Promise<AccountingThuChiLean | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await AccountingThuChiEntry.findById(id).lean();
  return doc as AccountingThuChiLean | null;
}

export async function createAccountingThuChiDoc(input: {
  txnDate: Date;
  effectivePaymentDate: Date | null;
  description: string;
  source: string;
  bank: string;
  thu: number | null;
  chi: number | null;
  notes: string;
  linkedAgencyId: mongoose.Types.ObjectId | null;
  linkedAgencyCode: string | null;
  linkedAgencyName: string | null;
}) {
  return AccountingThuChiEntry.create(input);
}

export async function updateAccountingThuChiDoc(
  id: string,
  input: Partial<{
    txnDate: Date;
    effectivePaymentDate: Date | null;
    description: string;
    source: string;
    bank: string;
    thu: number | null;
    chi: number | null;
    notes: string;
    linkedAgencyId: mongoose.Types.ObjectId | null;
    linkedAgencyCode: string | null;
    linkedAgencyName: string | null;
  }>
) {
  return AccountingThuChiEntry.findByIdAndUpdate(id, { $set: input }, { new: true }).lean();
}

export async function deleteAccountingThuChiDoc(id: string) {
  return AccountingThuChiEntry.findByIdAndDelete(id).lean();
}

/** Dòng có Chi > 0 và neo đại lý — phục vụ phân bổ Hoàn tiền */
export async function findLinkedChiEntries(): Promise<AccountingThuChiLean[]> {
  const items = await AccountingThuChiEntry.find({
    linkedAgencyId: { $ne: null },
    chi: { $gt: 0 },
  })
    .lean()
    .exec();
  return items as AccountingThuChiLean[];
}
