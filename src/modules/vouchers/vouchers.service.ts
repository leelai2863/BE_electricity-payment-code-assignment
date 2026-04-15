import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { writeAuditLog } from "@/lib/audit";
import { extractFieldsFromImage } from "@/lib/openai-vision";
import {
  findVouchers,
  updateVoucherAfterOcr,
  updateVoucherProfileById,
  approveVoucherById,
} from "./vouchers.repository";

export class VouchersServiceError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "VouchersServiceError";
    this.status = status;
  }
}

type OcrVoucherInput = {
  id: string;
  cccdBase64?: string;
  billBase64?: string;
  actorUserId?: string;
};

type UpdateVoucherProfileInput = {
  id: string;
  customerProfile: Record<string, unknown>;
  actorUserId?: string;
};

type ApproveVoucherInput = {
  id: string;
  actorUserId?: string;
};

function toActorObjectId(actorRaw?: string) {
  return mongoose.isValidObjectId(actorRaw)
    ? new mongoose.Types.ObjectId(actorRaw)
    : new mongoose.Types.ObjectId();
}

export async function getVouchers(status: string | null) {
  try {
    await connectDB();

    const filter: Record<string, number> = {};
    if (status !== null && status !== "" && !Number.isNaN(Number(status))) {
      filter.status = Number(status);
    }

    const data = await findVouchers(filter);
    return { data, source: "mongodb" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "MongoDB unavailable";
    throw new VouchersServiceError(message, 503);
  }
}

export async function ocrVoucher(input: OcrVoucherInput) {
  const merged: Record<string, unknown> = {};

  try {
    if (input.cccdBase64) {
      const r = await extractFieldsFromImage({
        base64DataUrl: input.cccdBase64,
        promptHint: "cccd",
      });
      Object.assign(merged, r.fields);
    }

    if (input.billBase64) {
      const r = await extractFieldsFromImage({
        base64DataUrl: input.billBase64,
        promptHint: "bill",
      });
      Object.assign(merged, r.fields);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "OCR failed";
    throw new VouchersServiceError(message, 502);
  }

  const actorId = toActorObjectId(input.actorUserId);

  try {
    await connectDB();

    const voucherId = new mongoose.Types.ObjectId(input.id);
    const doc = await updateVoucherAfterOcr(voucherId, merged);

    if (doc) {
      await writeAuditLog({
        actorUserId: actorId,
        action: "voucher.upload_ocr",
        entityType: "VoucherCode",
        entityId: voucherId,
        metadata: { fields: Object.keys(merged) },
      });
    }

    return { profile: merged, voucher: doc };
  } catch {
    return { profile: merged, voucher: null, persisted: false };
  }
}

export async function updateVoucherProfile(input: UpdateVoucherProfileInput) {
  try {
    await connectDB();

    const voucherId = new mongoose.Types.ObjectId(input.id);
    const actorId = toActorObjectId(input.actorUserId);

    const doc = await updateVoucherProfileById(voucherId, input.customerProfile);

    if (!doc) {
      throw new VouchersServiceError("Not found", 404);
    }

    await writeAuditLog({
      actorUserId: actorId,
      action: "voucher.profile_update",
      entityType: "VoucherCode",
      entityId: voucherId,
      metadata: { manualProfileUpdate: true },
    });

    return { ok: true, voucher: doc };
  } catch (e) {
    if (e instanceof VouchersServiceError) throw e;

    const message = e instanceof Error ? e.message : "Update failed";
    throw new VouchersServiceError(message, 503);
  }
}

export async function approveVoucher(input: ApproveVoucherInput) {
  const actorRaw = input.actorUserId ?? "000000000000000000000000";
  const actorUserId = mongoose.isValidObjectId(actorRaw)
    ? new mongoose.Types.ObjectId(actorRaw)
    : new mongoose.Types.ObjectId();

  try {
    await connectDB();

    const voucherId = new mongoose.Types.ObjectId(input.id);
    const approvedAt = new Date();

    const doc = await approveVoucherById(voucherId, actorUserId, approvedAt);

    if (!doc) {
      throw new VouchersServiceError("Not found", 404);
    }

    await writeAuditLog({
      actorUserId,
      action: "voucher.approve",
      entityType: "VoucherCode",
      entityId: voucherId,
      metadata: { approvedAt: approvedAt.toISOString() },
    });

    return {
      ok: true,
      approvedAt: approvedAt.toISOString(),
      voucherId: String(doc._id),
    };
  } catch (e) {
    if (e instanceof VouchersServiceError) throw e;

    const message = e instanceof Error ? e.message : "Approve failed";
    throw new VouchersServiceError(message, 503);
  }
}