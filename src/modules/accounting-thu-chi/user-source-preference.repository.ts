import mongoose from "mongoose";
import { UserSourcePreference } from "@/models/UserSourcePreference";

export function normalizeSourceForDedupe(display: string): string {
  return display.trim().replace(/\s+/g, " ").toUpperCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const HA_CUOC_SOURCE_DISPLAY = "Hạ Cước";
export const HA_CUOC_SOURCE_KIND = "HA_CUOC";

export async function getSourceCatalogEntryById(id: string): Promise<{
  _id: mongoose.Types.ObjectId;
  sourceDisplay: string;
  system: boolean;
} | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const row = await UserSourcePreference.findById(id).lean().exec();
  if (!row) return null;
  return {
    _id: row._id as mongoose.Types.ObjectId,
    sourceDisplay: String(row.sourceDisplay ?? ""),
    system: Boolean(row.system),
  };
}

export async function listSourceCatalog(params: { q?: string; limit: number }): Promise<
  Array<{
    _id: mongoose.Types.ObjectId;
    sourceDisplay: string;
    sourceNormalized: string;
    usageCount: number;
    lastUsedAt: Date;
    kind: string | null;
    system: boolean;
  }>
> {
  const limit = Math.min(50, Math.max(1, Math.trunc(params.limit)));
  const filter: Record<string, unknown> = {};
  const q = params.q?.trim();
  if (q) {
    const qNorm = normalizeSourceForDedupe(q);
    const escapedNorm = escapeRegex(qNorm);
    const escapedRaw = escapeRegex(q);
    filter.$or = [
      { sourceNormalized: new RegExp(`^${escapedNorm}`, "i") },
      { sourceDisplay: new RegExp(`^${escapedRaw}`, "i") },
    ];
  }

  const items = await UserSourcePreference.find(filter)
    .sort({ usageCount: -1, lastUsedAt: -1 })
    .limit(limit)
    .lean()
    .exec();

  return items.map((row) => ({
    _id: row._id as mongoose.Types.ObjectId,
    sourceDisplay: String(row.sourceDisplay ?? ""),
    sourceNormalized: String(row.sourceNormalized ?? ""),
    usageCount: typeof row.usageCount === "number" ? row.usageCount : 1,
    lastUsedAt: row.lastUsedAt instanceof Date ? row.lastUsedAt : new Date(),
    kind: typeof row.kind === "string" && row.kind.trim() ? row.kind.trim() : null,
    system: Boolean(row.system),
  }));
}

export async function upsertSourceCatalog(sourceDisplayRaw: string): Promise<void> {
  const sourceDisplay = sourceDisplayRaw.trim().slice(0, 120);
  if (!sourceDisplay) return;
  const sourceNormalized = normalizeSourceForDedupe(sourceDisplay);
  if (!sourceNormalized) return;

  const now = new Date();
  const isHaCuoc = sourceNormalized === normalizeSourceForDedupe(HA_CUOC_SOURCE_DISPLAY);
  await UserSourcePreference.updateOne(
    { sourceNormalized },
    {
      $set: {
        sourceDisplay,
        lastUsedAt: now,
        ...(isHaCuoc ? { kind: HA_CUOC_SOURCE_KIND, system: true } : {}),
      },
      $inc: { usageCount: 1 },
    },
    { upsert: true }
  );
}

/** Upsert nguồn Hạ Cước hệ thống (chạy seed/migration). */
export async function upsertHaCuocSystemSource(): Promise<void> {
  const sourceDisplay = HA_CUOC_SOURCE_DISPLAY;
  const sourceNormalized = normalizeSourceForDedupe(sourceDisplay);
  const now = new Date();
  await UserSourcePreference.updateOne(
    { sourceNormalized },
    {
      $set: {
        sourceDisplay,
        sourceNormalized,
        kind: HA_CUOC_SOURCE_KIND,
        system: true,
        lastUsedAt: now,
      },
      $setOnInsert: { usageCount: 1 },
    },
    { upsert: true }
  );
}

export async function updateSourceCatalogById(id: string, sourceDisplayRaw: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const current = await UserSourcePreference.findById(id).lean().exec();
  if (current?.system) return false;

  const sourceDisplay = sourceDisplayRaw.trim().slice(0, 120);
  if (!sourceDisplay) return false;
  const sourceNormalized = normalizeSourceForDedupe(sourceDisplay);
  if (!sourceNormalized) return false;

  const existing = await UserSourcePreference.findOne({ sourceNormalized }).lean().exec();
  if (existing && String(existing._id) !== id) {
    const selfRow = await UserSourcePreference.findById(id).lean().exec();
    if (selfRow) {
      const totalUsage = (Number(existing.usageCount) || 0) + (Number(selfRow.usageCount) || 0);
      const lastUsedAt = new Date(
        Math.max(
          new Date(existing.lastUsedAt ?? 0).getTime(),
          new Date(selfRow.lastUsedAt ?? 0).getTime(),
        ),
      );
      await UserSourcePreference.updateOne(
        { _id: existing._id },
        { $set: { sourceDisplay, sourceNormalized, usageCount: totalUsage, lastUsedAt } },
      );
      await UserSourcePreference.deleteOne({ _id: id });
      return true;
    }
    return false;
  }

  const updated = await UserSourcePreference.findByIdAndUpdate(
    id,
    { $set: { sourceDisplay, sourceNormalized } },
    { new: true },
  )
    .lean()
    .exec();
  return Boolean(updated);
}

export async function deleteSourceCatalogById(id: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(id)) return false;
  const cur = await UserSourcePreference.findById(id).lean().exec();
  if (cur?.system) return false;
  const deleted = await UserSourcePreference.findByIdAndDelete(id).lean().exec();
  return Boolean(deleted);
}
