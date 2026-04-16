import mongoose from "mongoose";
import { upsertBillFromChargeItem } from "@/lib/checkbill-charge-upsert";
import { BillingScanRepository } from "./billing-scan.repository";
import { serializeHistory } from "@/lib/electric-bill-serialize";

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
};
