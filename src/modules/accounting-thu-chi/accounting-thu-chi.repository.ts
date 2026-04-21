import mongoose from "mongoose";
import { AccountingThuChiEntry } from "@/models/AccountingThuChiEntry";

export type AccountingThuChiLean = {
  _id: mongoose.Types.ObjectId;
  txnDate: Date;
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

export async function listAccountingThuChiEntries(params: {
  from?: Date;
  to?: Date;
  agencyCode?: string;
  linkedAgencyId?: string;
  skip: number;
  limit: number;
}): Promise<{ items: AccountingThuChiLean[]; total: number }> {
  const q: Record<string, unknown> = {};
  if (params.from || params.to) {
    q.txnDate = {};
    if (params.from) (q.txnDate as Record<string, Date>).$gte = params.from;
    if (params.to) (q.txnDate as Record<string, Date>).$lte = params.to;
  }
  if (params.agencyCode?.trim()) {
    q.linkedAgencyCode = params.agencyCode.trim().toUpperCase();
  }
  if (params.linkedAgencyId?.trim()) {
    q.linkedAgencyId = new mongoose.Types.ObjectId(params.linkedAgencyId.trim());
  }

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
