import { VoucherCode } from "@/models/VoucherCode";
import type { VoucherRow } from "@/types/voucher";
import type { Types } from "mongoose";

type VoucherDoc = Record<string, unknown>;

export function mapVoucherDoc(doc: VoucherDoc): VoucherRow {
  const agencyRef = doc.agencyId as { _id?: unknown; name?: string } | string | null | undefined;

  let agencyId: string | null = null;
  let agencyName: string | undefined;

  if (agencyRef && typeof agencyRef === "object" && "_id" in agencyRef) {
    agencyId = String(agencyRef._id);
    agencyName = agencyRef.name != null ? String(agencyRef.name) : undefined;
  } else if (agencyRef) {
    agencyId = String(agencyRef);
  }

  return {
    _id: String(doc._id),
    code: String(doc.code),
    status: doc.status as VoucherRow["status"],
    agencyId,
    agencyName,
    billingScanHasBill:
      doc.billingScanHasBill === null || doc.billingScanHasBill === undefined
        ? null
        : Boolean(doc.billingScanHasBill),
    customerProfile: doc.customerProfile as VoucherRow["customerProfile"],
    cccdImageKey: doc.cccdImageKey as string | undefined,
    billImageKey: doc.billImageKey as string | undefined,
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt as Date).toISOString() : null,
    mailedAt: doc.mailedAt ? new Date(doc.mailedAt as Date).toISOString() : null,
    createdAt: new Date(doc.createdAt as Date).toISOString(),
    updatedAt: new Date(doc.updatedAt as Date).toISOString(),
  };
}

export async function findVouchers(filter: Record<string, number>) {
  const docs = await VoucherCode.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate("agencyId", "name")
    .lean();

  return (docs as unknown as VoucherDoc[]).map(mapVoucherDoc);
}

export async function updateVoucherAfterOcr(
  voucherId: Types.ObjectId,
  merged: Record<string, unknown>
) {
  return VoucherCode.findByIdAndUpdate(
    voucherId,
    {
      $set: {
        customerProfile: merged,
        ocrModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
        status: 2,
      },
    },
    { new: true }
  ).lean();
}

export async function updateVoucherProfileById(
  voucherId: Types.ObjectId,
  customerProfile: Record<string, unknown>
) {
  return VoucherCode.findByIdAndUpdate(
    voucherId,
    { $set: { customerProfile } },
    { new: true }
  ).lean();
}

export async function approveVoucherById(
  voucherId: Types.ObjectId,
  actorUserId: Types.ObjectId,
  approvedAt: Date
) {
  return VoucherCode.findByIdAndUpdate(
    voucherId,
    {
      $set: {
        status: 3,
        approvedAt,
        approvedByUserId: actorUserId,
      },
    },
    { new: true }
  ).lean();
}