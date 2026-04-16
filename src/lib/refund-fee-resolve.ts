import { RefundFeeRule } from "@/models/RefundFeeRule";
import { refundAnchorDateUtc, type MailQueueAnchorInput } from "@/lib/refund-anchor-date";

function normalizeTextKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export async function resolveRefundFeePct(
  agencyName: string,
  statusLabel: string,
  anchor: Date
): Promise<number | null> {
  const label = normalizeTextKey(statusLabel);
  if (!label) return null;
  const targetAgency = normalizeTextKey(agencyName);
  const docs = await RefundFeeRule.find({
    // Không lọc cứng statusLabel tại query vì DB có thể lưu có dấu (CHỜ),
    // trong khi key so khớp nghiệp vụ đã normalize (CHO).
    statusLabel: { $exists: true },
  })
    .sort({ effectiveFrom: -1 })
    .lean()
    .exec();

  const agencyDocs = docs.filter(
    (x) =>
      normalizeTextKey(String(x.agencyName ?? "")) === targetAgency &&
      normalizeTextKey(String(x.statusLabel ?? "")) === label
  );
  if (agencyDocs.length === 0) return null;

  const anchorMs = anchor.getTime();
  const byAnchor = agencyDocs.find((x) => new Date(String(x.effectiveFrom)).getTime() <= anchorMs);
  if (byAnchor && typeof byAnchor.pct === "number") return byAnchor.pct;

  // Fallback: không có rule <= anchor thì lấy rule mới nhất của agency+status
  const latest = agencyDocs[0];
  return latest && typeof latest.pct === "number" ? latest.pct : null;
}

export async function resolveRefundFeePctFromLine(
  agencyName: string,
  statusLabel: string,
  line: MailQueueAnchorInput
): Promise<number | null> {
  const anchor = refundAnchorDateUtc(line);
  return resolveRefundFeePct(agencyName, statusLabel, anchor);
}
