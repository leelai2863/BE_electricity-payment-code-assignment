import { RefundFeeRule } from "@/models/RefundFeeRule";
import { refundAnchorDateUtc, type MailQueueAnchorInput } from "@/lib/refund-anchor-date";
import type { RefundFeeRuleDto } from "@/types/electric-bill";

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

function normalizeCardType(input: string | null | undefined): "VP" | "SACOM" | "THUONG" | null {
  const key = normalizeTextKey(String(input ?? ""));
  if (!key) return "THUONG";
  if (key === "VP") return "VP";
  if (key === "SACOM" || key === "SA COM" || key === "SACOMBANK" || key === "SA COM BANK") return "SACOM";
  return "THUONG";
}

function normalizeConditionType(
  value: unknown
): "amount" | "cardType" | "manual" {
  const key = normalizeTextKey(String(value ?? ""));
  if (key === "AMOUNT") return "amount";
  if (key === "CARDTYPE") return "cardType";
  return "manual";
}

function isRuleActiveAtAnchor(rule: RefundFeeRuleDto, anchor: Date): boolean {
  if (!rule.isActive) return false;
  const at = anchor.getTime();
  const from = new Date(rule.effectiveFrom).getTime();
  if (Number.isNaN(from) || from > at) return false;
  if (!rule.effectiveTo) return true;
  const to = new Date(rule.effectiveTo).getTime();
  if (Number.isNaN(to)) return true;
  return to >= at;
}

function matchesRuleCondition(rule: RefundFeeRuleDto, amount: number | null, cardType: string | null): boolean {
  const condition = normalizeConditionType(rule.conditionType);
  if (condition === "cardType") {
    const want = normalizeCardType(rule.cardType);
    const got = normalizeCardType(cardType);
    return Boolean(want && got && want === got);
  }
  if (condition === "amount") {
    if (amount == null || !Number.isFinite(amount)) return false;
    const min = rule.amountMin;
    const max = rule.amountMax;
    if (min != null && amount < min) return false;
    if (max != null && amount > max) return false;
    return true;
  }
  return true;
}

function rulePriority(rule: RefundFeeRuleDto): number {
  const condition = normalizeConditionType(rule.conditionType);
  if (condition === "cardType") return 3;
  if (condition === "amount") return 2;
  return 1;
}

export function resolveRefundRuleFromRules(
  rules: RefundFeeRuleDto[],
  agencyName: string,
  amount: number | null,
  cardType: string | null,
  anchor: Date
): RefundFeeRuleDto | null {
  const targetAgency = normalizeTextKey(agencyName);
  const candidates = rules
    .filter((r) => normalizeTextKey(r.agencyName) === targetAgency)
    .filter((r) => isRuleActiveAtAnchor(r, anchor))
    .filter((r) => matchesRuleCondition(r, amount, cardType));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const p = rulePriority(b) - rulePriority(a);
    if (p !== 0) return p;
    const af = new Date(a.effectiveFrom).getTime();
    const bf = new Date(b.effectiveFrom).getTime();
    if (af !== bf) return bf - af;
    return String(b._id).localeCompare(String(a._id), "en");
  });
  return candidates[0] ?? null;
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

export async function resolveRefundRuleFromLine(
  agencyName: string,
  line: MailQueueAnchorInput & { amount: number | null; cardType: string | null }
): Promise<{ statusLabel: string; pct: number } | null> {
  const anchor = refundAnchorDateUtc(line);
  const docs = await RefundFeeRule.find({ isActive: true }).lean().exec();
  const rules = docs.map((x) => ({
    _id: String(x._id),
    agencyName: String(x.agencyName ?? ""),
    feeName: String(x.feeName ?? ""),
    statusLabel: String(x.statusLabel ?? ""),
    conditionType: normalizeConditionType(x.conditionType),
    amountMin: typeof x.amountMin === "number" ? x.amountMin : null,
    amountMax: typeof x.amountMax === "number" ? x.amountMax : null,
    cardType: x.cardType != null ? String(x.cardType) : null,
    pct: Number(x.pct),
    effectiveFrom: new Date(String(x.effectiveFrom)).toISOString(),
    effectiveTo: x.effectiveTo ? new Date(String(x.effectiveTo)).toISOString() : null,
    isActive: Boolean(x.isActive ?? true),
  })) satisfies RefundFeeRuleDto[];
  const found = resolveRefundRuleFromRules(rules, agencyName, line.amount, line.cardType, anchor);
  if (!found) return null;
  return { statusLabel: found.statusLabel, pct: found.pct };
}

export function resolveRefundFeePctFromRulesByStatus(
  rules: RefundFeeRuleDto[],
  agencyName: string,
  statusLabel: string,
  anchor: Date
): number | null {
  const normalizedAgency = normalizeTextKey(agencyName);
  const normalizedStatus = normalizeTextKey(statusLabel);
  if (!normalizedAgency || !normalizedStatus) return null;
  const active = rules
    .filter((r) => r.isActive)
    .filter((r) => normalizeTextKey(r.agencyName) === normalizedAgency)
    .filter((r) => normalizeTextKey(r.statusLabel) === normalizedStatus)
    .filter((r) => {
      const from = new Date(r.effectiveFrom).getTime();
      if (Number.isNaN(from) || from > anchor.getTime()) return false;
      if (!r.effectiveTo) return true;
      const to = new Date(r.effectiveTo).getTime();
      return Number.isNaN(to) ? true : to >= anchor.getTime();
    });
  if (active.length > 0) {
    active.sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
    return active[0]?.pct ?? null;
  }
  const fallback = rules
    .filter((r) => r.isActive)
    .filter((r) => normalizeTextKey(r.agencyName) === normalizedAgency)
    .filter((r) => normalizeTextKey(r.statusLabel) === normalizedStatus)
    .sort((a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
  return fallback[0]?.pct ?? null;
}
