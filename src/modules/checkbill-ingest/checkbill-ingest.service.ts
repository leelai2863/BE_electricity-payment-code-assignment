import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { mergeScanAmountIntoPeriods } from "@/lib/period-scan-merge";
import { BillingScanHistory } from "@/models/BillingScanHistory";
import { CheckbillIngestBatch } from "@/models/CheckbillIngestBatch";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import type { ElectricBillPeriod } from "@/types/electric-bill";

type IngestItem = {
  nguon: string;
  maKh: string;
  soTienDisplay: string;
  soTienVnd: number;
  tenKh: string;
};

type IngestBody = {
  event_type?: string;
  event_at?: string;
  project_id?: string;
  job_id?: string;
  job_source?: string;
  job_status?: string;
  charges_snapshot?: {
    snapshot_id?: number;
    completed_at?: string;
    comparison?: string;
    delta_row_count?: number;
    snapshot_row_count?: number;
    delta_total_amount_vnd?: number;
    total_amount_vnd?: number;
    items_delta_truncated?: boolean;
    items_delta?: Array<{
      nguon?: string;
      ma_kh?: string;
      so_tien_display?: string;
      so_tien_vnd?: number;
      ten_kh?: string;
    }>;
  };
};

const DEFAULT_MAX_ITEMS = 500;

function parseMaxItems(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ITEMS;
  return Math.min(5_000, Math.trunc(n));
}

function readAuthSecret(headers: Record<string, string | string[] | undefined>): string | null {
  const bearer = headers.authorization;
  if (typeof bearer === "string" && bearer.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length).trim();
  }
  const apiKey = headers["x-api-key"];
  return typeof apiKey === "string" ? apiKey.trim() : null;
}

function toIsoDate(raw: string | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function normalizeItems(body: IngestBody, maxItems: number): IngestItem[] {
  const arr = body.charges_snapshot?.items_delta;
  if (!Array.isArray(arr)) return [];
  if (arr.length > maxItems) {
    throw new Error(`items_delta vượt giới hạn cho phép (${maxItems})`);
  }
  return arr
    .map((x) => ({
      nguon: String(x?.nguon ?? "").trim(),
      maKh: String(x?.ma_kh ?? "").trim(),
      soTienDisplay: String(x?.so_tien_display ?? "").trim(),
      soTienVnd: Number(x?.so_tien_vnd ?? 0),
      tenKh: String(x?.ten_kh ?? "").trim(),
    }))
    .filter((x) => x.maKh && Number.isFinite(x.soTienVnd) && x.soTienVnd >= 0);
}

async function notifyGatewayIngestReceived(data: {
  batchId: string;
  jobId: string;
  snapshotId: number | null;
  receivedAt: string;
  completedAt: string | null;
  itemsAccepted: number;
}) {
  const callbackUrl = (process.env.CHECKBILL_GATEWAY_CALLBACK_URL ?? "").trim();
  if (!callbackUrl) return;
  const secret = (process.env.CHECKBILL_GATEWAY_CALLBACK_SECRET ?? "").trim();
  try {
    await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Checkbill-Ingest-Secret": secret } : {}),
      },
      body: JSON.stringify({
        event: "checkbill.ingest.received",
        ...data,
      }),
    });
  } catch {
    // no-op: callback failure does not affect ACK path
  }
}

export async function ingestChargesSnapshot(
  headers: Record<string, string | string[] | undefined>,
  body: IngestBody
) {
  await connectDB();

  const expectSecret = (process.env.CHECKBILL_INGEST_SECRET ?? "").trim();
  if (!expectSecret) {
    throw new Error("CHECKBILL_INGEST_SECRET chưa được cấu hình");
  }
  const gotSecret = readAuthSecret(headers);
  if (!gotSecret || gotSecret !== expectSecret) {
    return { status: 401 as const, payload: { error: "Unauthorized", code: "INVALID_SECRET" } };
  }

  const eventType = String(body.event_type ?? "").trim();
  const jobId = String(body.job_id ?? "").trim();
  if (!eventType || !jobId || !body.charges_snapshot) {
    return { status: 400 as const, payload: { error: "Thiếu event_type, job_id hoặc charges_snapshot" } };
  }

  const maxItems = parseMaxItems(process.env.CHECKBILL_INGEST_MAX_ITEMS);
  let items: IngestItem[] = [];
  try {
    items = normalizeItems(body, maxItems);
  } catch (error) {
    return {
      status: 413 as const,
      payload: { error: error instanceof Error ? error.message : "items_delta không hợp lệ" },
    };
  }

  const snapshotId =
    typeof body.charges_snapshot.snapshot_id === "number" ? body.charges_snapshot.snapshot_id : null;

  const duplicate = await CheckbillIngestBatch.findOne({
    $or: [{ jobId }, ...(snapshotId != null ? [{ snapshotId }] : [])],
  })
    .select("_id jobId snapshotId receivedAt processStatus")
    .lean();

  if (duplicate) {
    return {
      status: 200 as const,
      payload: {
        ok: true,
        duplicate: true,
        data: {
          batchId: String(duplicate._id),
          jobId: duplicate.jobId,
          snapshotId: duplicate.snapshotId ?? null,
          receivedAt:
            duplicate.receivedAt instanceof Date
              ? duplicate.receivedAt.toISOString()
              : new Date().toISOString(),
          processStatus: duplicate.processStatus,
        },
      },
    };
  }

  const now = new Date();
  const eventAt = toIsoDate(body.event_at, now);
  const completedAt = toIsoDate(body.charges_snapshot.completed_at, eventAt);

  const doc = await CheckbillIngestBatch.create({
    eventType,
    eventAt,
    projectId: String(body.project_id ?? "checkbill").trim(),
    jobId,
    snapshotId,
    jobSource: String(body.job_source ?? "").trim() || null,
    jobStatus: String(body.job_status ?? "").trim() || null,
    completedAt,
    comparison: String(body.charges_snapshot.comparison ?? "").trim() || null,
    deltaRowCount: Number(body.charges_snapshot.delta_row_count ?? items.length) || items.length,
    snapshotRowCount: Number(body.charges_snapshot.snapshot_row_count ?? 0) || 0,
    deltaTotalAmountVnd: Number(body.charges_snapshot.delta_total_amount_vnd ?? 0) || 0,
    totalAmountVnd: Number(body.charges_snapshot.total_amount_vnd ?? 0) || 0,
    itemsDeltaTruncated: Boolean(body.charges_snapshot.items_delta_truncated),
    items,
    processStatus: "received",
    receivedAt: now,
  });

  void notifyGatewayIngestReceived({
    batchId: String(doc._id),
    jobId,
    snapshotId,
    receivedAt: now.toISOString(),
    completedAt: completedAt.toISOString(),
    itemsAccepted: items.length,
  });

  return {
    status: 200 as const,
    payload: {
      ok: true,
      data: {
        batchId: String(doc._id),
        jobId,
        snapshotId,
        receivedAt: now.toISOString(),
        itemsAccepted: items.length,
      },
    },
  };
}

async function upsertBillFromItem(
  item: IngestItem,
  completedAt: Date
): Promise<void> {
  const year = completedAt.getUTCFullYear();
  const month = completedAt.getUTCMonth() + 1;
  const scanIso = completedAt.toISOString();
  const customerCode = item.maKh;
  const amount = Math.round(item.soTienVnd);
  const companyName = item.tenKh.trim();

  const existing = await ElectricBillRecord.findOne({ customerCode, year, month }).lean();
  const newPeriods = mergeScanAmountIntoPeriods(
    existing?.periods as ElectricBillPeriod[] | undefined,
    { amount, deadlineIso: null, scanIso }
  );

  if (existing) {
    await ElectricBillRecord.updateOne(
      { _id: existing._id },
      {
        $set: {
          periods: newPeriods,
          evn: item.nguon?.trim() || existing.evn || "EVNCPC",
          ...(companyName ? { company: companyName } : {}),
        },
      }
    );
  } else {
    await ElectricBillRecord.create({
      customerCode,
      year,
      month,
      monthLabel: `T${month}/${year}`,
      company: companyName || "",
      evn: item.nguon?.trim() || "EVNCPC",
      periods: newPeriods,
    });
  }

  await BillingScanHistory.create({
    jobId: null,
    customerCode,
    amount,
    status: "has_bill",
    scannedAt: completedAt,
    note: `ingest.checkbill ${item.nguon || "source_unknown"}`,
  });
}

export async function processIngestBatch(batchId: string) {
  await connectDB();

  if (!mongoose.isValidObjectId(batchId)) {
    return { status: 400 as const, payload: { error: "batchId không hợp lệ" } };
  }

  const doc = await CheckbillIngestBatch.findById(batchId).exec();
  if (!doc) return { status: 404 as const, payload: { error: "Không tìm thấy batch staging" } };
  if (doc.processStatus === "processed") {
    return { status: 200 as const, payload: { ok: true, data: { alreadyProcessed: true } } };
  }

  doc.processStatus = "processing";
  await doc.save();

  let processedCount = 0;
  let failedCount = 0;
  try {
    const completedAt = doc.completedAt instanceof Date ? doc.completedAt : new Date();
    for (const item of doc.items ?? []) {
      try {
        await upsertBillFromItem(
          {
            nguon: item.nguon,
            maKh: item.maKh,
            soTienDisplay: item.soTienDisplay,
            soTienVnd: item.soTienVnd,
            tenKh: item.tenKh,
          },
          completedAt
        );
        processedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    doc.processStatus = "processed";
    doc.processedAt = new Date();
    doc.processSummary = {
      processedCount,
      failedCount,
      errorMessage: null,
    };
    await doc.save();
    return {
      status: 200 as const,
      payload: {
        ok: true,
        data: {
          batchId: String(doc._id),
          processStatus: doc.processStatus,
          processedCount,
          failedCount,
          processedAt: doc.processedAt?.toISOString() ?? null,
        },
      },
    };
  } catch (error) {
    doc.processStatus = "failed";
    doc.processedAt = new Date();
    doc.processSummary = {
      processedCount,
      failedCount,
      errorMessage: error instanceof Error ? error.message : "Xử lý staging thất bại",
    };
    await doc.save();
    return {
      status: 500 as const,
      payload: {
        error: error instanceof Error ? error.message : "Xử lý staging thất bại",
      },
    };
  }
}

export async function processPendingIngestBatches(limitRaw: unknown) {
  await connectDB();
  const limitNum = Number(limitRaw);
  const limit = !Number.isFinite(limitNum) || limitNum <= 0 ? 5 : Math.min(100, Math.trunc(limitNum));
  const pending = await CheckbillIngestBatch.find({ processStatus: "received" })
    .sort({ receivedAt: 1 })
    .limit(limit)
    .select("_id")
    .lean();

  let processed = 0;
  let failed = 0;
  for (const p of pending) {
    const out = await processIngestBatch(String(p._id));
    if (out.status >= 200 && out.status < 300) processed += 1;
    else failed += 1;
  }
  return {
    status: 200 as const,
    payload: {
      ok: true,
      data: {
        pendingFound: pending.length,
        processed,
        failed,
      },
    },
  };
}

