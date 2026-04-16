import { mergeScanAmountIntoPeriods } from "@/lib/period-scan-merge";
import { BillingScanHistory } from "@/models/BillingScanHistory";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import type { ElectricBillPeriod } from "@/types/electric-bill";

export type ChargeIngestItem = {
  nguon: string;
  maKh: string;
  soTienDisplay: string;
  soTienVnd: number;
  tenKh: string;
};

export function chargeDedupeKey(maKh: string, soTienVnd: number): string {
  const code = String(maKh ?? "").trim().toUpperCase();
  const amt = Math.round(Number(soTienVnd));
  return `${code}|${amt}`;
}

/** Create or update electric bill from one checkbill charge row; append BillingScanHistory. */
export async function upsertBillFromChargeItem(item: ChargeIngestItem, completedAt: Date): Promise<void> {
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
