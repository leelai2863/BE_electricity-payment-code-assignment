import mongoose from "mongoose";
import { UserBankPreference } from "@/models/UserBankPreference";

export function normalizeBankForDedupe(display: string): string {
  return display.trim().replace(/\s+/g, " ").toUpperCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listBankCatalog(params: { q?: string; limit: number }): Promise<
  Array<{
    _id: mongoose.Types.ObjectId;
    bankDisplay: string;
    bankNormalized: string;
    usageCount: number;
    lastUsedAt: Date;
  }>
> {
  const limit = Math.min(50, Math.max(1, Math.trunc(params.limit)));
  const filter: Record<string, unknown> = {};
  const q = params.q?.trim();
  if (q) {
    const qNorm = normalizeBankForDedupe(q);
    const escapedNorm = escapeRegex(qNorm);
    const escapedRaw = escapeRegex(q);
    filter.$or = [
      { bankNormalized: new RegExp(`^${escapedNorm}`, "i") },
      { bankDisplay: new RegExp(`^${escapedRaw}`, "i") },
    ];
  }

  const items = await UserBankPreference.find(filter)
    .sort({ usageCount: -1, lastUsedAt: -1 })
    .limit(limit)
    .lean()
    .exec();

  return items.map((row) => ({
    _id: row._id as mongoose.Types.ObjectId,
    bankDisplay: String(row.bankDisplay ?? ""),
    bankNormalized: String(row.bankNormalized ?? ""),
    usageCount: typeof row.usageCount === "number" ? row.usageCount : 1,
    lastUsedAt: row.lastUsedAt instanceof Date ? row.lastUsedAt : new Date(),
  }));
}

/**
 * Ghi nhận ngân hàng vào danh mục dùng chung của hệ thống.
 */
export async function upsertBankCatalog(bankDisplayRaw: string): Promise<void> {
  const bankDisplay = bankDisplayRaw.trim().slice(0, 120);
  if (!bankDisplay) return;
  const bankNormalized = normalizeBankForDedupe(bankDisplay);
  if (!bankNormalized) return;

  const now = new Date();
  await UserBankPreference.updateOne(
    { bankNormalized },
    {
      $set: { bankDisplay, lastUsedAt: now },
      $inc: { usageCount: 1 },
    },
    { upsert: true }
  );
}

export async function updateBankCatalogById(id: string, bankDisplayRaw: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const bankDisplay = bankDisplayRaw.trim().slice(0, 120);
  if (!bankDisplay) return false;
  const bankNormalized = normalizeBankForDedupe(bankDisplay);
  if (!bankNormalized) return false;

  const existing = await UserBankPreference.findOne({ bankNormalized }).lean().exec();
  if (existing && String(existing._id) !== id) {
    // merge usage vào bản ghi cũ nếu trùng tên chuẩn hóa
    const current = await UserBankPreference.findById(id).lean().exec();
    if (current) {
      const totalUsage = (Number(existing.usageCount) || 0) + (Number(current.usageCount) || 0);
      const lastUsedAt = new Date(
        Math.max(
          new Date(existing.lastUsedAt ?? 0).getTime(),
          new Date(current.lastUsedAt ?? 0).getTime(),
        ),
      );
      await UserBankPreference.updateOne(
        { _id: existing._id },
        { $set: { bankDisplay, bankNormalized, usageCount: totalUsage, lastUsedAt } },
      );
      await UserBankPreference.deleteOne({ _id: id });
      return true;
    }
    return false;
  }

  const updated = await UserBankPreference.findByIdAndUpdate(
    id,
    { $set: { bankDisplay, bankNormalized } },
    { new: true },
  )
    .lean()
    .exec();
  return Boolean(updated);
}

export async function deleteBankCatalogById(id: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const deleted = await UserBankPreference.findByIdAndDelete(id).lean().exec();
  return Boolean(deleted);
}
