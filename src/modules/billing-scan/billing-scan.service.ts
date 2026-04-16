import mongoose from "mongoose";
import { chargeDedupeKey, upsertBillFromChargeItem } from "@/lib/checkbill-charge-upsert";
import { BillingScanRepository } from "./billing-scan.repository";
import { serializeHistory } from "@/lib/electric-bill-serialize";
import { connectDB } from "@/lib/mongodb";
import { CheckbillIngestBatch } from "@/models/CheckbillIngestBatch";
import { ChargesStagingRow } from "@/models/ChargesStagingRow";
import { getLocalBillingScanMockItems } from "./billing-scan.local-mock";

export type ChargesStagingRowSerialized = {
  _id: string;
  nguon: string;
  maKh: string;
  soTienDisplay: string;
  soTienVnd: number;
  tenKh: string;
  jobId: string;
  snapshotId: number | null;
  ingestBatchId: string;
  receivedAt: string;
  snapshotCompletedAt: string | null;
};

function iso(d: Date | undefined | null): string | null {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function serializeStagingRow(doc: Record<string, unknown>): ChargesStagingRowSerialized {
  return {
    _id: String(doc._id),
    nguon: String(doc.nguon ?? ""),
    maKh: String(doc.maKh ?? ""),
    soTienDisplay: String(doc.soTienDisplay ?? ""),
    soTienVnd: Number(doc.soTienVnd ?? 0),
    tenKh: String(doc.tenKh ?? ""),
    jobId: String(doc.jobId ?? ""),
    snapshotId: typeof doc.snapshotId === "number" ? doc.snapshotId : null,
    ingestBatchId: String(doc.ingestBatchId ?? ""),
    receivedAt: iso(doc.receivedAt as Date) ?? new Date().toISOString(),
    snapshotCompletedAt: iso(doc.snapshotCompletedAt as Date | undefined),
  };
}

export const BillingScanService = {
  async getHistory() {
    const rows = await BillingScanRepository.findHistory();
    return rows.map((r) => serializeHistory(r as Record<string, unknown>));
  },

  async getScannedCodes(): Promise<ChargesStagingRowSerialized[]> {
    const docs = await BillingScanRepository.findChargesStagingPending();
    return docs.map((d) => serializeStagingRow(d as Record<string, unknown>));
  },

  async approveScannedCode(stagingId: string) {
    if (!mongoose.isValidObjectId(stagingId)) {
      return { status: 400 as const, payload: { error: "staging id is not valid" } };
    }
    const row = await BillingScanRepository.findChargesStagingById(stagingId);
    if (!row) {
      return { status: 404 as const, payload: { error: "Không tìm thấy dòng staging" } };
    }
    const r = row as Record<string, unknown>;
    const completedAtRaw = r.snapshotCompletedAt as Date | undefined;
    const completedAt =
      completedAtRaw instanceof Date && !Number.isNaN(completedAtRaw.getTime())
        ? completedAtRaw
        : new Date();

    await upsertBillFromChargeItem(
      {
        nguon: String(r.nguon ?? ""),
        maKh: String(r.maKh ?? ""),
        soTienDisplay: String(r.soTienDisplay ?? ""),
        soTienVnd: Number(r.soTienVnd ?? 0),
        tenKh: String(r.tenKh ?? ""),
      },
      completedAt
    );

    await BillingScanRepository.deleteChargesStagingById(stagingId);

    return {
      status: 200 as const,
      payload: {
        ok: true,
        data: {
          stagingId,
          customerCode: String(r.maKh ?? ""),
        },
      },
    };
  },

  async approveScannedCodesBatch(idsInput: unknown[]) {
    const normalized = idsInput
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
    const ids = [...new Set(normalized)];
    if (ids.length === 0) {
      return {
        status: 400 as const,
        payload: {
          ok: false,
          error: "ids must be a non-empty array",
        },
      };
    }

    let approved = 0;
    const errors: Array<{ id: string; error: string }> = [];
    for (const id of ids) {
      const result = await this.approveScannedCode(id);
      if (result.status === 200 && (result.payload as { ok?: boolean })?.ok) {
        approved += 1;
        continue;
      }
      errors.push({
        id,
        error: String((result.payload as { error?: unknown })?.error ?? "approve_failed"),
      });
    }

    return {
      status: 200 as const,
      payload: {
        ok: errors.length === 0,
        data: {
          requested: ids.length,
          approved,
          failed: ids.length - approved,
          errors,
        },
      },
    };
  },

  async seedLocalMockScannedCodes() {
    const allowMock = String(process.env.BILLING_SCAN_LOCAL_MOCK_ENABLED ?? "").trim() === "1";
    const nodeEnv = String(process.env.NODE_ENV ?? "").trim();
    if (!allowMock || nodeEnv === "production") {
      return {
        status: 403 as const,
        payload: {
          ok: false,
          error: "mock_seed_disabled",
          message: "Set BILLING_SCAN_LOCAL_MOCK_ENABLED=1 (local only) to enable mock seed endpoint",
        },
      };
    }

    await connectDB();

    const now = new Date();
    const rows = getLocalBillingScanMockItems();
    const jobId = `local-mock-billingscan-${now.getTime()}`;
    const snapshotId = null;
    const completedAt = now;

    const batch = await CheckbillIngestBatch.create({
      eventType: "checkbill.charges_snapshot",
      eventAt: now,
      projectId: "local-mock",
      jobId,
      snapshotId,
      jobSource: "local",
      jobStatus: "mocked",
      completedAt,
      comparison: "mock-seed",
      deltaRowCount: rows.length,
      snapshotRowCount: rows.length,
      deltaTotalAmountVnd: rows.reduce((sum, x) => sum + x.soTienVnd, 0),
      totalAmountVnd: rows.reduce((sum, x) => sum + x.soTienVnd, 0),
      itemsDeltaTruncated: false,
      itemsTruncated: false,
      rawRowCount: rows.length,
      dedupeUniqueCount: rows.length,
      dedupeDuplicateCount: 0,
      items: rows,
      processStatus: "received",
      receivedAt: now,
    });

    await ChargesStagingRow.insertMany(
      rows.map((it) => ({
        dedupeHash: chargeDedupeKey(it.maKh, it.soTienVnd),
        nguon: it.nguon,
        maKh: it.maKh,
        soTienDisplay: it.soTienDisplay,
        soTienVnd: it.soTienVnd,
        tenKh: it.tenKh,
        jobId,
        snapshotId,
        ingestBatchId: batch._id,
        snapshotCompletedAt: completedAt,
        receivedAt: now,
      }))
    );

    return {
      status: 200 as const,
      payload: {
        ok: true,
        data: {
          seeded: rows.length,
          jobId,
          ingestBatchId: String(batch._id),
        },
      },
    };
  },
};
