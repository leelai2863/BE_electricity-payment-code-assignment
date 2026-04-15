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
  statusLabel: string;
  pct: number;
  effectiveFrom: Date;
}): RefundFeeRuleDto {
  return {
    _id: String(doc._id),
    agencyName: doc.agencyName,
    statusLabel: doc.statusLabel,
    pct: doc.pct,
    effectiveFrom:
      doc.effectiveFrom instanceof Date ? doc.effectiveFrom.toISOString() : String(doc.effectiveFrom),
  };
}