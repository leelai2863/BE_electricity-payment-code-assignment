import mongoose from "mongoose";
import type { RefundFeeRuleDto, RefundLineStateDto } from "@/types/electric-bill";

export function serializeRefundLineStateDoc(doc: {
  billId: string;
  ky: number;
  agencyName: string;
  status?: string;
  phiPct?: number | null;
  daHoan?: number;
  updatedAt?: Date;
}): RefundLineStateDto {
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

export function serializeRefundFeeRuleDoc(doc: {
  _id: mongoose.Types.ObjectId;
  agencyName: string;
  feeName?: string;
  statusLabel: string;
  conditionType?: "amount" | "cardType" | "manual";
  amountMin?: number | null;
  amountMax?: number | null;
  cardType?: string | null;
  pct: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  isActive?: boolean;
}): RefundFeeRuleDto {
  return {
    _id: String(doc._id),
    agencyName: doc.agencyName,
    feeName: doc.feeName ?? "",
    statusLabel: doc.statusLabel,
    conditionType: doc.conditionType ?? "manual",
    amountMin: doc.amountMin ?? null,
    amountMax: doc.amountMax ?? null,
    cardType: doc.cardType ?? null,
    pct: doc.pct,
    effectiveFrom:
      doc.effectiveFrom instanceof Date ? doc.effectiveFrom.toISOString() : String(doc.effectiveFrom),
    effectiveTo:
      doc.effectiveTo instanceof Date
        ? doc.effectiveTo.toISOString()
        : doc.effectiveTo
          ? String(doc.effectiveTo)
          : null,
    isActive: doc.isActive ?? true,
  };
}