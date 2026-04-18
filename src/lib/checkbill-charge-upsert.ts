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
  /** Kỳ hóa đơn EVN (kyBill) — chỉ dùng khi đủ cặp tháng + năm hợp lệ */
  evnKyBillThang?: number | null;
  evnKyBillNam?: number | null;
};

/** Trả về cặp (thang, nam) khi ingest có đủ hai giá trị hợp lệ; không thì null. */
export function evnKyBillPairFromIngestItem(item: ChargeIngestItem): { thang: number; nam: number } | null {
  const t = item.evnKyBillThang;
  const n = item.evnKyBillNam;
  if (t == null || n == null) return null;
  const thang = Math.trunc(Number(t));
  const nam = Math.trunc(Number(n));
  if (!Number.isInteger(thang) || thang < 1 || thang > 12) return null;
  if (!Number.isInteger(nam) || nam < 2000 || nam > 2100) return null;
  return { thang, nam };
}

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
  const evnPair = evnKyBillPairFromIngestItem(item);

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
          ...(evnPair
            ? { evnKyBillThang: evnPair.thang, evnKyBillNam: evnPair.nam }
            : {}),
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
      ...(evnPair ? { evnKyBillThang: evnPair.thang, evnKyBillNam: evnPair.nam } : {}),
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
