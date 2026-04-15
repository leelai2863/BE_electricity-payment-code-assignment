import { RefundFeeRule } from "@/models/RefundFeeRule";
import { refundAnchorDateUtc, type MailQueueAnchorInput } from "@/lib/refund-anchor-date";

export async function resolveRefundFeePct(
  agencyName: string,
  statusLabel: string,
  anchor: Date
): Promise<number | null> {
  const label = statusLabel.trim().toUpperCase();
  if (!label) return null;
  const doc = await RefundFeeRule.findOne({
    agencyName,
    statusLabel: label,
    effectiveFrom: { $lte: anchor },
  })
    .sort({ effectiveFrom: -1 })
    .lean()
    .exec();
  if (!doc) return null;
  return typeof doc.pct === "number" ? doc.pct : null;
}

export async function resolveRefundFeePctFromLine(
  agencyName: string,
  statusLabel: string,
  line: MailQueueAnchorInput
): Promise<number | null> {
  const anchor = refundAnchorDateUtc(line);
  return resolveRefundFeePct(agencyName, statusLabel, anchor);
}
