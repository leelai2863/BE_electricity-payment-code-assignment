import { normalizeScanDdMmInput } from "@/lib/scan-ddmm";

/** Lấy yyyy-mm-dd theo lịch tường Việt Nam rồi neo UTC 00:00 cùng số ngày (ổn định ghép Thu chi / phí). */
function utcMidnightForHoChiMinhCalendarDateOf(dt: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }
  return new Date(Date.UTC(year, month - 1, day));
}

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
    return utcMidnightForHoChiMinhCalendarDateOf(dt);
  }
  return new Date(Date.UTC(input.year, Math.max(0, input.month - 1), 1));
}
