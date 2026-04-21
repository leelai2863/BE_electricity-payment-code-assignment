import type { MailQueueLineDto, RefundLineStateDto } from "@/types/electric-bill";
import { allocateProportionalInt } from "@/lib/allocate-proportional";
import { normalizeTextKey } from "@/lib/refund-fee-resolve";
import { refundAnchorDateUtc } from "@/lib/refund-anchor-date";
import type { AccountingThuChiLean } from "@/modules/accounting-thu-chi/accounting-thu-chi.repository";

/** Trọng số phân bổ ~ cột Hoàn (số tiền − thành phí) trên UI hoàn tiền */
function hoanWeight(amount: number | null, phiPct: number | null): number {
  if (amount == null || amount <= 0) return 0;
  const pct = phiPct != null && Number.isFinite(phiPct) ? phiPct : 0;
  const fee = Math.round((amount * pct) / 100);
  return Math.max(0, Math.trunc(amount - fee));
}

function lineKey(billId: string, ky: number) {
  return `${billId}_k${ky}`;
}

function toDdMmFromDateInHoChiMinh(d: Date): string | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(d);
  const dd = parts.find((p) => p.type === "day")?.value ?? "";
  const mm = parts.find((p) => p.type === "month")?.value ?? "";
  if (!dd || !mm) return null;
  return `${dd}/${mm}`;
}

function lineDateKeyDdMm(line: MailQueueLineDto): string | null {
  const anchor = refundAnchorDateUtc({
    year: line.year,
    month: line.month,
    scanDdMm: line.scanDdMm,
    dealCompletedAt: line.dealCompletedAt,
  });
  if (Number.isNaN(anchor.getTime())) return null;
  const dd = String(anchor.getUTCDate()).padStart(2, "0");
  const mm = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/**
 * Cộng phân bổ Chi (thu chi, Nguồn = mã đại lý) vào từng dòng refundLineStates.
 * Ghép dòng mail-queue qua `billId` + `ky` (không phụ thuộc thứ tự mảng).
 *
 * `agencyCurrentNameById`: tên đại lý đọc lại từ DB tại thời điểm gọi (ObjectId string → name),
 * tránh lệch khi đổi tên đại lý sau khi ghi bút toán (linkedAgencyName trong bút toán là snapshot).
 */
export function mergeThuChiAllocationsIntoRefundStates(
  lines: MailQueueLineDto[],
  resolvedLineStates: RefundLineStateDto[],
  chiEntries: AccountingThuChiLean[],
  agencyCurrentNameById: Map<string, string>
): void {
  const lineByKey = new Map<string, MailQueueLineDto>();
  for (const line of lines) {
    lineByKey.set(lineKey(line.billId, line.ky), line);
  }

  for (const s of resolvedLineStates) {
    s.daHoanFromThuChi = 0;
    s.daHoanTotal = s.daHoan;
  }

  const chiByAgencyDate = new Map<string, number>();
  for (const e of chiEntries) {
    const idStr = e.linkedAgencyId ? String(e.linkedAgencyId) : "";
    const nameFromDb = idStr ? (agencyCurrentNameById.get(idStr) ?? "").trim() : "";
    const name = nameFromDb || String(e.linkedAgencyName ?? "").trim();
    if (!name) continue;
    const dateKey = toDdMmFromDateInHoChiMinh(new Date(e.txnDate));
    if (!dateKey) continue;
    const key = `${normalizeTextKey(name)}__${dateKey}`;
    const c = typeof e.chi === "number" ? Math.trunc(e.chi) : 0;
    if (c <= 0) continue;
    chiByAgencyDate.set(key, (chiByAgencyDate.get(key) ?? 0) + c);
  }

  const lineIndicesByAgencyDate = new Map<string, number[]>();
  for (let i = 0; i < resolvedLineStates.length; i++) {
    const st = resolvedLineStates[i];
    const line = lineByKey.get(lineKey(st.billId, st.ky));
    const dateKey = line ? lineDateKeyDdMm(line) : null;
    if (!dateKey) continue;
    const key = `${normalizeTextKey(st.agencyName)}__${dateKey}`;
    const arr = lineIndicesByAgencyDate.get(key) ?? [];
    arr.push(i);
    lineIndicesByAgencyDate.set(key, arr);
  }

  for (const [agencyDateKey, totalChi] of chiByAgencyDate) {
    const indices = lineIndicesByAgencyDate.get(agencyDateKey) ?? [];
    if (indices.length === 0 || totalChi <= 0) continue;
    const weights = indices.map((idx) => {
      const st = resolvedLineStates[idx];
      const line = lineByKey.get(lineKey(st.billId, st.ky));
      return hoanWeight(line?.amount ?? null, line?.resolvedPhiPct ?? null);
    });
    const parts = allocateProportionalInt(totalChi, weights);
    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j];
      const add = parts[j] ?? 0;
      const cur = resolvedLineStates[idx];
      cur.daHoanFromThuChi = add;
      cur.daHoanTotal = cur.daHoan + add;
    }
  }
}

/** Cảnh báo tài chính sau khi đã gắn phân bổ thu chi lên refundLineStates */
export function buildRefundFinancialWarnings(states: RefundLineStateDto[]): string[] {
  const warns: string[] = [];
  let doubleCountLines = 0;
  for (const s of states) {
    const fromTc = s.daHoanFromThuChi ?? 0;
    if (fromTc > 0 && s.daHoan > 0) doubleCountLines += 1;
  }
  if (doubleCountLines > 0) {
    warns.push(
      `Có ${doubleCountLines} dòng vừa có tiền từ bảng thu chi (Nguồn = mã đại lý, cột Chi) vừa có «Đã hoàn nhập tay» trong cơ sở dữ liệu — nguy cơ cộng trùng khoản chi. Nên chỉ nhập tay phần chênh lệch (nếu có) sau khi đối chiếu với thu chi, hoặc xóa nhập tay nếu thu chi đã đủ.`
    );
  }
  return warns;
}
