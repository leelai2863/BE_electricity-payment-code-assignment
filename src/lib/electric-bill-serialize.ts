import type { BillingScanHistoryRow, CaSlot, ElectricBillDto, ElectricBillPeriod } from "@/types/electric-bill";
import type { ElectricBillRecordDocument } from "@/models/ElectricBillRecord";
import type { BillingScanHistoryDocument } from "@/models/BillingScanHistory";

function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Date(d).toISOString();
}

function normalizeCa(s: unknown): CaSlot | null {
  const v = s != null ? String(s) : "";
  if (v === "10h" || v === "16h" || v === "24h") return v;
  return null;
}

export function defaultPeriods(params?: {
  firstAmount?: number | null;
  firstDeadline?: Date | null;
  scanDate?: Date;
}): ElectricBillPeriod[] {
  const scan = params?.scanDate ?? new Date();
  const d1 = params?.firstDeadline ?? null;
  return [1, 2, 3].map((ky) => ({
    ky: ky as 1 | 2 | 3,
    amount: ky === 1 ? (params?.firstAmount ?? null) : null,
    paymentDeadline: ky === 1 && d1 ? d1.toISOString() : null,
    scanDate: ky === 1 ? scan.toISOString() : null,
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
  }));
}

export function serializeElectricBill(doc: ElectricBillRecordDocument | Record<string, unknown>): ElectricBillDto {
  const d = doc as Record<string, unknown>;
  const periodsRaw = (d.periods as Record<string, unknown>[]) ?? [];
  const billAssignedId = d.assignedAgencyId ? String(d.assignedAgencyId) : null;
  const billAssignedName = d.assignedAgencyName != null ? String(d.assignedAgencyName) : null;
  const billCustomer = d.customerName != null ? String(d.customerName) : null;
  const billPay = Boolean(d.paymentConfirmed);
  const billCccd = Boolean(d.cccdConfirmed);
  const billCard = d.cardType != null ? String(d.cardType) : null;
  const legacyBillDeal = iso(d.dealCompletedAt as Date | undefined);

  const periods: ElectricBillPeriod[] = [1, 2, 3].map((ky) => {
    const p = periodsRaw.find((x) => Number(x.ky) === ky);
    const scanIso = iso(p?.scanDate as Date | undefined);
    const rawDd = p?.scanDdMm != null ? String(p.scanDdMm).trim() : "";
    /** Chỉ dùng giá trị lưu; không đồng bộ từ scanDate (người dùng / hệ thống tự nhập dd/mm). */
    const scanDdMm = rawDd || null;

    const pid = p?.assignedAgencyId != null && String(p.assignedAgencyId).trim() ? String(p.assignedAgencyId) : null;
    const pname = p?.assignedAgencyName != null && String(p.assignedAgencyName).trim() ? String(p.assignedAgencyName) : null;

    const periodDeal = iso(p?.dealCompletedAt as Date | undefined);

    return {
      ky: ky as 1 | 2 | 3,
      amount: p?.amount != null ? Number(p.amount) : null,
      paymentDeadline: iso(p?.paymentDeadline as Date | undefined),
      scanDate: scanIso,
      scanDdMm,
      ca: normalizeCa(p?.ca),
      /** Mỗi kỳ được lập — không fallback bill / kỳ khác */
      assignedAgencyId: pid,
      assignedAgencyName: pname,
      dlGiaoName: p?.dlGiaoName != null && String(p.dlGiaoName).trim() ? String(p.dlGiaoName) : null,
      paymentConfirmed: Boolean(p?.paymentConfirmed),
      cccdConfirmed: Boolean(p?.cccdConfirmed),
      customerName:
        p?.customerName != null && String(p.customerName).trim() ? String(p.customerName) : null,
      cardType: p?.cardType != null && String(p.cardType).trim() ? String(p.cardType) : null,
      /** Hồ sơ cũ: dealCompletedAt cấp bill chỉ gần kỳ 1 */
      dealCompletedAt: periodDeal ?? (ky === 1 ? legacyBillDeal : null),
    };
  });

  return {
    _id: String(d._id),
    customerCode: String(d.customerCode),
    month: Number(d.month),
    year: Number(d.year),
    monthLabel: String(d.monthLabel ?? ""),
    evn: String(d.evn ?? "EVNCPC"),
    company: String(d.company ?? ""),
    periods,
    assignedAgencyId: billAssignedId,
    assignedAgencyName: billAssignedName,
    assignedAt: iso(d.assignedAt as Date | undefined),
    customerName: billCustomer,
    paymentConfirmed: billPay,
    cccdConfirmed: billCccd,
    cardType: billCard,
    dealCompletedAt: legacyBillDeal,
  };
}

/** Còn ít nhất một kỳ có cước chưa hoàn tất ✅ */
export function billHasIncompletePeriod(dto: ElectricBillDto): boolean {
  return dto.periods.some((p) => p.amount != null && !p.dealCompletedAt);
}

/** Có ít nhất một kỳ có cước và mọi kỳ có cước đều đã hoàn tất ✓ */
export function billIsFullyCompleted(dto: ElectricBillDto): boolean {
  const hasBillable = dto.periods.some((p) => p.amount != null);
  if (!hasBillable) return false;
  return dto.periods.every((p) => p.amount == null || Boolean(p.dealCompletedAt));
}

export function serializeHistory(doc: BillingScanHistoryDocument | Record<string, unknown>): BillingScanHistoryRow {
  const d = doc as Record<string, unknown>;
  return {
    _id: String(d._id),
    customerCode: String(d.customerCode),
    amount: d.amount != null ? Number(d.amount) : null,
    status: d.status as BillingScanHistoryRow["status"],
    scannedAt: iso(d.scannedAt as Date) ?? new Date().toISOString(),
    jobId: d.jobId ? String(d.jobId) : null,
  };
}



