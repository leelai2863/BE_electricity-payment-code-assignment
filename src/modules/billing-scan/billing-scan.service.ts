import mongoose from "mongoose";
import { upsertBillFromChargeItem, chargeDedupeKey } from "@/lib/checkbill-charge-upsert";
import { connectDB } from "@/lib/mongodb";
import { periodsDtoToMongoSchema } from "@/lib/electric-bill-mongo-periods";
import { serializeElectricBill, serializeHistory } from "@/lib/electric-bill-serialize";
import { CheckbillIngestBatch } from "@/models/CheckbillIngestBatch";
import { ChargesStagingRow } from "@/models/ChargesStagingRow";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import type { ElectricBillPeriod } from "@/types/electric-bill";
import type { BillLevelSyncDoc } from "@/modules/electric-bills/electric-bills.helpers";
import { syncBillLevelFromPeriods } from "@/modules/electric-bills/electric-bills.helpers";
import { BillingScanRepository } from "./billing-scan.repository";

const REVOKE_SCAN_JOB_ID = "__core_revoke_scan_approval__";

function isAdminRoles(actorRoles: unknown): boolean {
  if (!Array.isArray(actorRoles)) return false;
  const s = new Set(
    actorRoles.map((x) => String(x ?? "").trim().toUpperCase()).filter(Boolean)
  );
  return s.has("ADMIN") || s.has("SUPER_ADMIN");
}

function emptyPeriodDto(ky: 1 | 2 | 3): ElectricBillPeriod {
  return {
    ky,
    amount: null,
    paymentDeadline: null,
    scanDate: null,
    scanDdMm: null,
    ca: null,
    assignedAgencyId: null,
    assignedAgencyName: null,
    dlGiaoName: null,
    paymentConfirmed: false,
    cccdConfirmed: false,
    customerName: null,
    cardType: null,
    dealCompletedAt: null,
  };
}

function renumberKeptPeriods(kept: ElectricBillPeriod[]): ElectricBillPeriod[] {
  const base: ElectricBillPeriod[] = [emptyPeriodDto(1), emptyPeriodDto(2), emptyPeriodDto(3)];
  const sorted = [...kept].sort((a, b) => a.ky - b.ky);
  sorted.forEach((src, idx) => {
    if (idx >= 3) return;
    const ky = (idx + 1) as 1 | 2 | 3;
    base[idx] = {
      ...emptyPeriodDto(ky),
      ky,
      amount: src.amount,
      paymentDeadline: src.paymentDeadline,
      scanDate: src.scanDate,
      scanDdMm: src.scanDdMm,
      ca: src.ca,
      assignedAgencyId: src.assignedAgencyId,
      assignedAgencyName: src.assignedAgencyName,
      dlGiaoName: src.dlGiaoName,
      paymentConfirmed: src.paymentConfirmed,
      cccdConfirmed: src.cccdConfirmed,
      customerName: src.customerName,
      cardType: src.cardType,
      dealCompletedAt: src.dealCompletedAt,
    };
  });
  return base;
}

async function getOrCreateRevokeIngestBatchId(): Promise<mongoose.Types.ObjectId> {
  await connectDB();
  const existing = await CheckbillIngestBatch.findOne({ jobId: REVOKE_SCAN_JOB_ID }).select("_id").lean();
  if (existing && existing._id) {
    return existing._id as mongoose.Types.ObjectId;
  }
  const now = new Date();
  const created = await CheckbillIngestBatch.create({
    eventType: "revoke_scan_approval",
    eventAt: now,
    projectId: "checkbill",
    jobId: REVOKE_SCAN_JOB_ID,
    snapshotId: null,
    completedAt: now,
    items: [],
    processStatus: "processed",
    receivedAt: now,
  });
  return created._id;
}

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
    const year = completedAt.getUTCFullYear();
    const month = completedAt.getUTCMonth() + 1;
    const customerCode = String(r.maKh ?? "").trim();
    const amount = Math.round(Number(r.soTienVnd ?? 0));

    const alreadyInAssigned = await BillingScanRepository.existsElectricBillAmountInMonth(
      customerCode,
      amount,
      year,
      month
    );
    if (alreadyInAssigned) {
      await BillingScanRepository.deleteChargesStagingById(stagingId);
      return {
        status: 200 as const,
        payload: {
          ok: true,
          data: {
            stagingId,
            customerCode,
            skipped: true,
            reason: "duplicate_with_assigned_table",
          },
        },
      };
    }

    await upsertBillFromChargeItem(
      {
        nguon: String(r.nguon ?? ""),
        maKh: customerCode,
        soTienDisplay: String(r.soTienDisplay ?? ""),
        soTienVnd: amount,
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
          customerCode,
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

  /**
   * Revoke scan approval: restore ChargesStagingRow; ADMIN only.
   */
  async revokeElectricBillScanApproval(billId: string, actorRoles: unknown) {
    if (!isAdminRoles(actorRoles)) {
      return { status: 403 as const, payload: { error: "Chi ADMIN moi duoc huy duyet." } };
    }
    if (!mongoose.isValidObjectId(billId)) {
      return { status: 400 as const, payload: { error: "bill id khong hop le" } };
    }

    await connectDB();
    const billLean = await ElectricBillRecord.findById(billId).lean();
    if (!billLean) {
      return { status: 404 as const, payload: { error: "Không tìm thấy hóa đơn" } };
    }

    const dto = serializeElectricBill(billLean as Record<string, unknown>);

    if (dto.dealCompletedAt) {
      return { status: 400 as const, payload: { error: "Hoa don da hoan tat — khong the huy duyet." } };
    }

    for (const p of dto.periods) {
      if (p.dealCompletedAt) {
        return { status: 400 as const, payload: { error: "Co ky da hoan tat — khong the huy duyet." } };
      }
      if (p.assignedAgencyId?.trim()) {
        return { status: 409 as const, payload: { error: "Da gan dai ly — khong the huy duyet." } };
      }
    }

    const revokeKys = new Set<number>();
    for (const p of dto.periods) {
      if (p.amount != null && p.scanDate) revokeKys.add(p.ky);
    }
    if (revokeKys.size === 0) {
      return {
        status: 400 as const,
        payload: { error: "Khong co ky nao tu quet cuoc de huy duyet." },
      };
    }

    const batchId = await getOrCreateRevokeIngestBatchId();
    const customerCode = dto.customerCode.trim();
    const evn = (dto.evn ?? "").trim() || "EVNCPC";
    const company = (dto.company ?? "").trim();
    const now = new Date();

    for (const p of dto.periods) {
      if (!revokeKys.has(p.ky)) continue;
      const amount = Math.round(Number(p.amount));
      if (!Number.isFinite(amount)) continue;
      const dedupeHash = chargeDedupeKey(customerCode, amount);
      const scanDate = p.scanDate ? new Date(p.scanDate) : new Date(dto.year, dto.month - 1);
      const soTienDisplay = amount.toLocaleString("vi-VN");
      await ChargesStagingRow.updateOne(
        { dedupeHash },
        {
          $setOnInsert: {
            dedupeHash,
            nguon: evn,
            maKh: customerCode,
            soTienDisplay,
            soTienVnd: amount,
            tenKh: company,
            jobId: REVOKE_SCAN_JOB_ID,
            snapshotId: null,
            ingestBatchId: batchId,
            snapshotCompletedAt: scanDate,
          },
          $set: { receivedAt: now },
        },
        { upsert: true }
      );
    }

    const kept = dto.periods.filter((p) => !revokeKys.has(p.ky) && p.amount != null);
    const nextPeriods = renumberKeptPeriods(kept);
    const hasAnyAmount = nextPeriods.some((p) => p.amount != null);

    if (!hasAnyAmount) {
      await ElectricBillRecord.findByIdAndDelete(billId);
      return {
        status: 200 as const,
        payload: {
          ok: true,
          data: { billDeleted: true, revivedStagingCount: revokeKys.size, customerCode },
          source: "mongodb",
        },
      };
    }

    const doc = await ElectricBillRecord.findById(billId);
    if (!doc) {
      return { status: 404 as const, payload: { error: "Không tìm thấy hóa đơn" } };
    }

    doc.set("periods", periodsDtoToMongoSchema(nextPeriods));
    syncBillLevelFromPeriods(doc as BillLevelSyncDoc, nextPeriods);
    doc.markModified("periods");
    await doc.save();

    return {
      status: 200 as const,
      payload: {
        ok: true,
        data: { billDeleted: false, revivedStagingCount: revokeKys.size, customerCode },
        source: "mongodb",
      },
    };
  },
};
