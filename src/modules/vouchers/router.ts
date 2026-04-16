import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { writeAuditLog } from "@/lib/audit";
import { extractFieldsFromImage } from "@/lib/openai-vision";
import { VoucherCode } from "@/models/VoucherCode";
import type { VoucherRow } from "@/types/voucher";

const router = Router();

function mapDoc(doc: Record<string, unknown>): VoucherRow {
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

/** GET /api/vouchers?status= */
router.get("/", async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  try {
    await connectDB();
    const filter: Record<string, number> = {};
    if (status !== null && status !== "" && !Number.isNaN(Number(status))) {
      filter.status = Number(status);
    }
    const docs = await VoucherCode.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("agencyId", "name")
      .lean();
    const data = (docs as unknown as Record<string, unknown>[]).map(mapDoc);
    res.json({ data, source: "mongodb" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "MongoDB unavailable";
    res.status(503).json({ error: message, data: [] });
  }
});

/** POST /api/vouchers/:id/ocr */
router.post("/:id/ocr", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as {
    cccdBase64?: string;
    billBase64?: string;
    actorUserId?: string;
  };

  const merged: Record<string, unknown> = {};
  try {
    if (body.cccdBase64) {
      const r = await extractFieldsFromImage({ base64DataUrl: body.cccdBase64, promptHint: "cccd" });
      Object.assign(merged, r.fields);
    }
    if (body.billBase64) {
      const r = await extractFieldsFromImage({ base64DataUrl: body.billBase64, promptHint: "bill" });
      Object.assign(merged, r.fields);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "OCR failed";
    res.status(502).json({ error: message });
    return;
  }

  const actorRaw = body.actorUserId;
  const actorId = mongoose.isValidObjectId(actorRaw)
    ? new mongoose.Types.ObjectId(actorRaw)
    : new mongoose.Types.ObjectId();

  try {
    await connectDB();
    const oid = new mongoose.Types.ObjectId(id);
    const doc = await VoucherCode.findByIdAndUpdate(
      oid,
      {
        $set: {
          customerProfile: merged,
          ocrModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
          status: 2,
        },
      },
      { new: true }
    ).lean();

    if (doc) {
      await writeAuditLog({
        actorUserId: actorId,
        action: "voucher.upload_ocr",
        entityType: "VoucherCode",
        entityId: oid,
        metadata: { fields: Object.keys(merged) },
      });
    }

    res.json({ profile: merged, voucher: doc });
  } catch {
    res.json({ profile: merged, voucher: null, persisted: false });
  }
});

/** PATCH /api/vouchers/:id/profile */
router.patch("/:id/profile", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as {
    customerProfile?: Record<string, unknown>;
    actorUserId?: string;
  };

  if (!body.customerProfile || typeof body.customerProfile !== "object") {
    res.status(400).json({ error: "customerProfile required" });
    return;
  }

  const actorRaw = body.actorUserId;
  const actorId = mongoose.isValidObjectId(actorRaw)
    ? new mongoose.Types.ObjectId(actorRaw)
    : new mongoose.Types.ObjectId();

  try {
    await connectDB();
    const oid = new mongoose.Types.ObjectId(id);
    const doc = await VoucherCode.findByIdAndUpdate(
      oid,
      { $set: { customerProfile: body.customerProfile } },
      { new: true }
    ).lean();

    if (!doc) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await writeAuditLog({
      actorUserId: actorId,
      action: "voucher.profile_update",
      entityType: "VoucherCode",
      entityId: oid,
      metadata: { manualProfileUpdate: true },
    });

    res.json({ ok: true, voucher: doc });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    res.status(503).json({ error: message });
  }
});

/** POST /api/vouchers/:id/approve */
router.post("/:id/approve", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as { actorUserId?: string };

  const actorRaw = body.actorUserId ?? "000000000000000000000000";
  const actorUserId = mongoose.isValidObjectId(actorRaw)
    ? new mongoose.Types.ObjectId(actorRaw)
    : new mongoose.Types.ObjectId();

  try {
    await connectDB();
    const oid = new mongoose.Types.ObjectId(id);
    const approvedAt = new Date();
    const doc = await VoucherCode.findByIdAndUpdate(
      oid,
      {
        $set: {
          status: 3,
          approvedAt,
          approvedByUserId: actorUserId,
        },
      },
      { new: true }
    ).lean();

    if (!doc) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await writeAuditLog({
      actorUserId,
      action: "voucher.approve",
      entityType: "VoucherCode",
      entityId: oid,
      metadata: { approvedAt: approvedAt.toISOString() },
    });

    res.json({
      ok: true,
      approvedAt: approvedAt.toISOString(),
      voucherId: String(doc._id),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Approve failed";
    res.status(503).json({ error: message });
  }
});

export default router;
