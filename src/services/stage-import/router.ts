import { Router, type Request, type Response, type NextFunction } from "express";
import { EJSON } from "bson";
import mongoose, { type Model } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { Agency } from "@/models/Agency";
import { AssignedCode } from "@/models/AssignedCode";
import { AuditLog } from "@/models/AuditLog";
import { BillingScanHistory } from "@/models/BillingScanHistory";
import { BillingScanJob } from "@/models/BillingScanJob";
import { CustomerAccount } from "@/models/CustomerAccount";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import { VoucherCode } from "@/models/VoucherCode";

const MAX_DOCS_PER_REQUEST = 2000;

/** Whitelist: URL param must match Mongoose collection name (Compass). */
const COLLECTION_TO_MODEL: Record<string, Model<unknown>> = {
  agencies: Agency as Model<unknown>,
  assignedcodes: AssignedCode as Model<unknown>,
  auditlogs: AuditLog as Model<unknown>,
  billingscanhistories: BillingScanHistory as Model<unknown>,
  billingscanjobs: BillingScanJob as Model<unknown>,
  customeraccounts: CustomerAccount as Model<unknown>,
  electricbillrecords: ElectricBillRecord as Model<unknown>,
  vouchercodes: VoucherCode as Model<unknown>,
};

const router = Router();

function stageImportGuard(req: Request, res: Response, next: NextFunction): void {
  if (process.env.STAGE_IMPORT_ENABLED !== "true") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const secret = process.env.STAGE_IMPORT_SECRET;
  if (!secret || secret.length < 8) {
    res.status(503).json({ error: "STAGE_IMPORT_SECRET must be set (min 8 chars) when import is enabled" });
    return;
  }
  const header = req.get("x-stage-import-secret");
  if (header !== secret) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

router.use(stageImportGuard);

/**
 * POST /api/stage-import/:collection
 * Header: x-stage-import-secret: <STAGE_IMPORT_SECRET>
 * Body: { "documents": [ ... ] } — Extended JSON (Compass export) or plain JSON with string ObjectIds.
 */
router.post("/:collection", async (req: Request, res: Response) => {
  const collection = String(req.params.collection ?? "").toLowerCase();
  const Model = COLLECTION_TO_MODEL[collection];
  if (!Model) {
    res.status(400).json({
      error: "Unknown collection",
      allowed: Object.keys(COLLECTION_TO_MODEL),
    });
    return;
  }

  const body = req.body as { documents?: unknown };
  if (!Array.isArray(body.documents)) {
    res.status(400).json({ error: "Body must be JSON: { \"documents\": [ ... ] }" });
    return;
  }

  const documents = body.documents;
  if (documents.length === 0) {
    res.json({
      collection,
      upsertedCount: 0,
      modifiedCount: 0,
      matchedCount: 0,
      insertedCount: 0,
    });
    return;
  }

  if (documents.length > MAX_DOCS_PER_REQUEST) {
    res.status(400).json({
      error: `Too many documents (max ${MAX_DOCS_PER_REQUEST} per request). Split into batches.`,
    });
    return;
  }

  try {
    await connectDB();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Database connection failed";
    res.status(503).json({ error: message });
    return;
  }

  const ops: unknown[] = [];

  for (let i = 0; i < documents.length; i++) {
    const raw = documents[i];
    if (typeof raw !== "object" || raw === null) {
      res.status(400).json({ error: `documents[${i}] must be an object` });
      return;
    }

    let doc: Record<string, unknown>;
    try {
      doc = EJSON.parse(JSON.stringify(raw), { relaxed: true }) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: `documents[${i}]: invalid Extended JSON` });
      return;
    }

    const rawId = doc._id;
    if (rawId == null) {
      res.status(400).json({ error: `documents[${i}]: missing _id` });
      return;
    }

    const idString =
      typeof rawId === "object" && rawId !== null && "$oid" in (rawId as object)
        ? String((rawId as { $oid: string }).$oid)
        : String(rawId);

    if (!mongoose.isValidObjectId(idString)) {
      res.status(400).json({ error: `documents[${i}]: invalid _id` });
      return;
    }

    const id = new mongoose.Types.ObjectId(idString);
    doc._id = id;

    ops.push({
      replaceOne: {
        filter: { _id: id },
        replacement: doc,
        upsert: true,
      },
    });
  }

  try {
    const result = await Model.bulkWrite(ops as never, { ordered: false });
    res.json({
      collection,
      upsertedCount: result.upsertedCount,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      insertedCount: result.insertedCount,
      deletedCount: result.deletedCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: message });
  }
});

export default router;
