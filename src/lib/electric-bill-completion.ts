import type { ElectricBillPeriod } from "@/types/electric-bill";
import { isValidScanDdMm, normalizeScanDdMmInput } from "@/lib/scan-ddmm";

/** Đủ điều kiện ✓ hoàn tất cho một kỳ (chuyển Đi mail). */
export function isPeriodReadyForDealCompletion(p: ElectricBillPeriod): boolean {
  if (p.dealCompletedAt) return false;
  if (p.amount == null) return false;
  if (!p.assignedAgencyId?.trim()) return false;
  if (!p.customerName?.trim()) return false;
  if (!p.paymentConfirmed || !p.cccdConfirmed) return false;
  if (!isValidScanDdMm(p.scanDdMm)) return false;
  if (p.ca !== "10h" && p.ca !== "16h" && p.ca !== "24h") return false;
  return true;
}

/** Tên KH thật — loại placeholder UI ("Tên KH"). */
export function isRealCustomerNameValue(customerName: unknown): boolean {
  const t = customerName != null ? String(customerName).trim() : "";
  if (!t) return false;
  if (/^tên\s*kh$/i.test(t)) return false;
  return true;
}

function splitPartAgencySatisfied(
  part: Record<string, unknown>,
  partIdx: 1 | 2,
  splitIsThuChi: boolean
): boolean {
  const hasCatalog = part.assignedAgencyId != null && String(part.assignedAgencyId).trim().length > 0;
  const ag = part.assignedAgencyName != null ? String(part.assignedAgencyName).trim() : "";
  const dl = part.dlGiaoName != null ? String(part.dlGiaoName).trim() : "";
  if (partIdx === 1 && splitIsThuChi) {
    return hasCatalog || (ag.length > 0 && dl.length > 0);
  }
  // Phần "Còn lại · ĐL" của entry Thu chi: cho phép cùng cơ chế nhãn + ĐL TT (dữ liệu cũ / không có ObjectId).
  if (partIdx === 2 && splitIsThuChi) {
    return hasCatalog || (ag.length > 0 && dl.length > 0);
  }
  return hasCatalog;
}

/**
 * Đủ thông tin từ cột Ngày thanh toán trở đi (CA, Bill/CCCD, tên KH, đại lý) để coi là có thể chốt ✓.
 * Dùng API PATCH và kiểm tra bill chưa/đã xác nhận với hạ cước.
 */
export function splitSubperiodHasFullConfirmationData(
  part: Record<string, unknown>,
  partIdx: 1 | 2,
  splitMeta: { createdBy?: string | null; lockedByThuChi?: boolean | null }
): boolean {
  if (part.amount == null || !Number.isFinite(Number(part.amount))) return false;
  let scan = part.scanDdMm != null ? String(part.scanDdMm).trim() : "";
  const scanNorm = normalizeScanDdMmInput(scan);
  if (scanNorm) scan = scanNorm;
  if (!scan || !isValidScanDdMm(scan)) return false;
  const ca = part.ca;
  if (ca !== "10h" && ca !== "16h" && ca !== "24h") return false;
  if (!part.paymentConfirmed) return false;
  if (!part.cccdConfirmed) return false;
  if (!isRealCustomerNameValue(part.customerName)) return false;
  const thuChi = splitMeta.createdBy === "thu-chi" || Boolean(splitMeta.lockedByThuChi);
  return splitPartAgencySatisfied(part, partIdx, thuChi);
}
