import { normalizeScanDdMmInput } from "@/lib/scan-ddmm";

export type MailQueueAnchorInput = {
  year: number;
  month: number;
  scanDdMm: string | null;
  dealCompletedAt: string;
};

/** Ngày neo (UTC 00:00) để chọn mức phí theo lịch sử rule: ưu tiên ngày TT trong kỳ hóa đơn, fallback ngày xác nhận. */
export function refundAnchorDateUtc(input: MailQueueAnchorInput): Date {
  const scan = normalizeScanDdMmInput(String(input.scanDdMm ?? "").trim());
  if (scan && Number.isInteger(input.year) && Number.isInteger(input.month)) {
    const m = scan.match(/^(\d{2})\/(\d{2})$/);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return new Date(Date.UTC(input.year, mo - 1, d));
      }
    }
  }
  const dt = new Date(input.dealCompletedAt);
  if (!Number.isNaN(dt.getTime())) {
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }
  return new Date(Date.UTC(input.year, Math.max(0, input.month - 1), 1));
}
