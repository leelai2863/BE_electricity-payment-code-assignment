import mongoose from "mongoose";
import { writeAuditLog } from "@/lib/audit";
import { ELEC_SYSTEM_AUDIT_ACTOR_ID } from "@/lib/elec-crm-audit";
import { connectDB } from "@/lib/mongodb";
import { chargeDedupeKey, type ChargeIngestItem } from "@/lib/checkbill-charge-upsert";
import { BillingScanHistory } from "@/models/BillingScanHistory";
import { CheckbillIngestBatch } from "@/models/CheckbillIngestBatch";
import { ChargesStagingRow } from "@/models/ChargesStagingRow";

type RawChargeRow = {
  nguon?: string;
  ma_kh?: string;
  so_tien_display?: string;
  so_tien_vnd?: number;
  ten_kh?: string;
  /** Kỳ hóa đơn EVN — gửi cùng lúc với evn_ky_bill_nam */
  evn_ky_bill_thang?: number;
  evn_ky_bill_nam?: number;
  evnKyBillThang?: number;
  evnKyBillNam?: number;
};

type ChargesSnapshot = {
  snapshot_id?: number;
  job_id?: string;
  completed_at?: string;
  comparison?: string;
  delta_row_count?: number;
  snapshot_row_count?: number;
  delta_total_amount_vnd?: number;
  total_amount_vnd?: number;
  items_delta_truncated?: boolean;
  items_truncated?: boolean;
  items_row_count_in_payload?: number;
  items_delta?: RawChargeRow[];
  items?: RawChargeRow[];
  json_by_job_url?: string | null;
};

type IngestBody = {
  event_type?: string;
  event_at?: string;
  time_zone?: string;
  project_id?: string;
  job_id?: string;
  job_source?: string;
  job_status?: string;
  charges_snapshot?: ChargesSnapshot;
};

const DEFAULT_MAX_ITEMS = 500;

function parseMaxItems(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_ITEMS;
  return Math.min(5_000, Math.trunc(n));
}

function parseFetchTimeoutMs(): number {
  const n = Number(process.env.CHECKBILL_INGEST_FETCH_TIMEOUT_MS);
  if (!Number.isFinite(n) || n < 5_000) return 120_000;
  return Math.min(300_000, Math.trunc(n));
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

function readOptionalKyBillInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function mapRawRow(x: RawChargeRow | undefined): ChargeIngestItem | null {
  if (!x) return null;
  const maKh = String(x.ma_kh ?? "").trim();
  const soTienVnd = Number(x.so_tien_vnd ?? 0);
  if (!maKh || !Number.isFinite(soTienVnd) || soTienVnd < 0) return null;
  const t = readOptionalKyBillInt(x.evn_ky_bill_thang ?? x.evnKyBillThang);
  const n = readOptionalKyBillInt(x.evn_ky_bill_nam ?? x.evnKyBillNam);
  const base: ChargeIngestItem = {
    nguon: String(x.nguon ?? "").trim(),
    maKh,
    soTienDisplay: String(x.so_tien_display ?? "").trim(),
    soTienVnd,
    tenKh: String(x.ten_kh ?? "").trim(),
  };
  if (
    t != null &&
    n != null &&
    t >= 1 &&
    t <= 12 &&
    n >= 2000 &&
    n <= 2100
  ) {
    base.evnKyBillThang = t;
    base.evnKyBillNam = n;
  }
  return base;
}

function extractItemsArrayFromJson(body: unknown): RawChargeRow[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  const snap = o.charges_snapshot;
  if (snap && typeof snap === "object") {
    const items = (snap as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as RawChargeRow[];
  }
  if (Array.isArray(o.items)) return o.items as RawChargeRow[];
  return [];
}

async function fetchFullItemsFromCheckbill(url: string): Promise<RawChargeRow[]> {
  const timeout = parseFetchTimeoutMs();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`Fetch full snapshot HTTP ${res.status}`);
    }
    const json = (await res.json()) as unknown;
    return extractItemsArrayFromJson(json);
  } finally {
    clearTimeout(t);
  }
}

function normalizeItemsFromSnapshot(
  snap: ChargesSnapshot | undefined,
  maxItems: number
): { rows: ChargeIngestItem[]; mustFetchFull: boolean } {
  if (!snap) return { rows: [], mustFetchFull: false };
  const mustFetchFull = Boolean(snap.items_truncated) || Boolean(snap.items_delta_truncated);

  let raw: RawChargeRow[] = [];
  if (Array.isArray(snap.items) && snap.items.length > 0) {
    raw = snap.items;
  } else if (Array.isArray(snap.items_delta) && snap.items_delta.length > 0) {
    raw = snap.items_delta;
  }

  return {
    rows: mustFetchFull ? [] : finalizeRows(raw, maxItems),
    mustFetchFull,
  };
}

function finalizeRows(raw: RawChargeRow[], maxItems: number): ChargeIngestItem[] {
  const out: ChargeIngestItem[] = [];
  for (const x of raw) {
    const m = mapRawRow(x);
    if (m) out.push(m);
  }
  if (out.length > maxItems) {
    throw new Error(`items vượt giới hạn cho phép (${maxItems})`);
  }
  return out;
}

function dedupeItems(items: ChargeIngestItem[]): {
  unique: ChargeIngestItem[];
  duplicateCount: number;
} {
  const map = new Map<string, ChargeIngestItem>();
  for (const it of items) {
    const k = chargeDedupeKey(it.maKh, it.soTienVnd);
    if (!map.has(k)) map.set(k, it);
  }
  const unique = [...map.values()];
  return { unique, duplicateCount: items.length - unique.length };
}

async function filterExistingFromApprovedHistory(
  items: ChargeIngestItem[],
  completedAt: Date
): Promise<{ fresh: ChargeIngestItem[]; duplicateApprovedCount: number }> {
  if (items.length === 0) return { fresh: [], duplicateApprovedCount: 0 };
  if (!(completedAt instanceof Date) || Number.isNaN(completedAt.getTime())) {
    return { fresh: items, duplicateApprovedCount: 0 };
  }

  const year = completedAt.getUTCFullYear();
  const month = completedAt.getUTCMonth(); // 0-based
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  const codes = [...new Set(items.map((it) => String(it.maKh ?? "").trim()).filter(Boolean))];
  const amounts = [...new Set(items.map((it) => Math.round(Number(it.soTienVnd ?? 0))))];
  if (codes.length === 0 || amounts.length === 0) return { fresh: items, duplicateApprovedCount: 0 };

  const hist = await BillingScanHistory.find({
    customerCode: { $in: codes },
    amount: { $in: amounts },
    scannedAt: { $gte: start, $lt: end },
    status: "has_bill",
  })
    .select({ customerCode: 1, amount: 1, _id: 0 })
    .lean();

  if (!hist || hist.length === 0) return { fresh: items, duplicateApprovedCount: 0 };

  const seen = new Set(
    hist.map((h) => `${String((h as { customerCode?: unknown }).customerCode ?? "").trim().toUpperCase()}|${Math.round(
      Number((h as { amount?: unknown }).amount ?? 0)
    )}`)
  );

  const fresh = items.filter((it) => {
    const k = `${String(it.maKh ?? "").trim().toUpperCase()}|${Math.round(Number(it.soTienVnd ?? 0))}`;
    return !seen.has(k);
  });
  return { fresh, duplicateApprovedCount: items.length - fresh.length };
}

async function notifyGatewayIngestReceived(data: {
  batchId: string;
  jobId: string;
  snapshotId: number | null;
  receivedAt: string;
  completedAt: string | null;
  itemsAccepted: number;
}) {
  const callbackUrl = (process.env.GATEWAY_CALLBACK_URL ?? process.env.CHECKBILL_GATEWAY_CALLBACK_URL ?? "").trim();
  if (!callbackUrl) return;
  const secret = (process.env.GATEWAY_CALLBACK_SECRET ?? process.env.CHECKBILL_GATEWAY_CALLBACK_SECRET ?? "").trim();
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
  if (eventType !== "checkbill.charges_snapshot") {
    return { status: 400 as const, payload: { error: "event_type phải là checkbill.charges_snapshot" } };
  }
  if (!jobId || !body.charges_snapshot) {
    return { status: 400 as const, payload: { error: "Thiếu job_id hoặc charges_snapshot" } };
  }

  const maxItems = parseMaxItems(process.env.RECEIVED_INGEST_MAX_ITEMS ?? process.env.CHECKBILL_INGEST_MAX_ITEMS);
  const snap = body.charges_snapshot;

  const itemsTruncatedForStore = Boolean(snap.items_truncated) || Boolean(snap.items_delta_truncated);
  let rawRows: ChargeIngestItem[] = [];
  let usedFetch = false;

  try {
    const first = normalizeItemsFromSnapshot(snap, maxItems);
    if (first.mustFetchFull) {
      const url = typeof snap.json_by_job_url === "string" ? snap.json_by_job_url.trim() : "";
      if (!url) {
        return {
          status: 503 as const,
          payload: {
            error: "items_truncated nhưng thiếu json_by_job_url — không thể tải dữ liệu",
          },
        };
      }
      const fetchedRaw = await fetchFullItemsFromCheckbill(url);
      rawRows = finalizeRows(fetchedRaw, maxItems);
      usedFetch = true;
    } else {
      rawRows = first.rows;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Không đọc được items";
    return {
      status: /abort|fetch/i.test(msg) ? (503 as const) : (413 as const),
      payload: { error: msg },
    };
  }

  const rawRowCount = rawRows.length;
  const { unique, duplicateCount } = dedupeItems(rawRows);

  const snapshotId = typeof snap.snapshot_id === "number" ? snap.snapshot_id : null;

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
  const completedAt = toIsoDate(snap.completed_at, eventAt);
  const batchOid = new mongoose.Types.ObjectId();
  let itemsAccepted = 0;
  let duplicateExistingCount = 0;
  let duplicateApprovedCount = 0;

  const { fresh: freshAfterApproved, duplicateApprovedCount: dupApproved } =
    await filterExistingFromApprovedHistory(unique, completedAt);
  duplicateApprovedCount = dupApproved;

  if (freshAfterApproved.length > 0) {
    const bulkResult = await ChargesStagingRow.bulkWrite(
      freshAfterApproved.map((it) => ({
        updateOne: {
          filter: { dedupeHash: chargeDedupeKey(it.maKh, it.soTienVnd) },
          update: {
            $setOnInsert: {
              dedupeHash: chargeDedupeKey(it.maKh, it.soTienVnd),
              nguon: it.nguon,
              maKh: it.maKh,
              soTienDisplay: it.soTienDisplay,
              soTienVnd: it.soTienVnd,
              tenKh: it.tenKh,
              ...(it.evnKyBillThang != null && it.evnKyBillNam != null
                ? { evnKyBillThang: it.evnKyBillThang, evnKyBillNam: it.evnKyBillNam }
                : {}),
              jobId,
              snapshotId,
              ingestBatchId: batchOid,
              snapshotCompletedAt: completedAt,
              receivedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    itemsAccepted = Number((bulkResult as { upsertedCount?: number }).upsertedCount ?? 0);
    duplicateExistingCount = freshAfterApproved.length - itemsAccepted;
  }

  const totalDuplicateDropped = duplicateCount + duplicateApprovedCount + duplicateExistingCount;

  const doc = await CheckbillIngestBatch.create({
    _id: batchOid,
    eventType,
    eventAt,
    projectId: String(body.project_id ?? "checkbill").trim(),
    jobId,
    snapshotId,
    jobSource: String(body.job_source ?? "").trim() || null,
    jobStatus: String(body.job_status ?? "").trim() || null,
    completedAt,
    comparison: String(snap.comparison ?? "").trim() || null,
    deltaRowCount: Number(snap.delta_row_count ?? itemsAccepted) || itemsAccepted,
    snapshotRowCount: Number(snap.snapshot_row_count ?? rawRowCount) || rawRowCount,
    deltaTotalAmountVnd: Number(snap.delta_total_amount_vnd ?? 0) || 0,
    totalAmountVnd: Number(snap.total_amount_vnd ?? 0) || 0,
    itemsDeltaTruncated: Boolean(snap.items_delta_truncated),
    itemsTruncated: itemsTruncatedForStore,
    rawRowCount,
    dedupeUniqueCount: itemsAccepted,
    dedupeDuplicateCount: totalDuplicateDropped,
    items: unique,
    processStatus: "received",
    receivedAt: now,
  });

  try {
    await writeAuditLog({
      actorUserId: new mongoose.Types.ObjectId(ELEC_SYSTEM_AUDIT_ACTOR_ID),
      action: "checkbill.ingest_charges_snapshot",
      entityType: "CheckbillIngestBatch",
      entityId: batchOid,
      metadata: {
        jobId,
        snapshotId,
        itemsAccepted,
        rawRowCount,
        duplicateRowsDropped: totalDuplicateDropped,
        fullFetch: usedFetch,
        projectId: String(body.project_id ?? "checkbill").trim(),
      },
    });
  } catch {
    /* ingest vẫn ACK — audit phụ */
  }

  void notifyGatewayIngestReceived({
    batchId: String(doc._id),
    jobId,
    snapshotId,
    receivedAt: now.toISOString(),
    completedAt: completedAt.toISOString(),
    itemsAccepted,
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
        itemsAccepted,
        rawRowCount,
        duplicateRowsDropped: totalDuplicateDropped,
        fullFetch: usedFetch,
      },
    },
  };
}

