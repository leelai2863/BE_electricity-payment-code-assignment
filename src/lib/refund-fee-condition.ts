import type { RefundFeeRuleDto } from "@/types/electric-bill";

export type RefundFeeRuleConditionType = RefundFeeRuleDto["conditionType"];

const ALLOWED: readonly RefundFeeRuleConditionType[] = [
  "amount",
  "cardType",
  "manual",
  "fixed",
  "advance",
  "wait",
];

export function normalizeRefundFeeConditionInput(
  value: unknown,
  fallback: RefundFeeRuleConditionType
): RefundFeeRuleConditionType {
  const s = String(value ?? "").trim().toLowerCase();
  if ((ALLOWED as readonly string[]).includes(s)) return s as RefundFeeRuleConditionType;
  return fallback;
}

/** Trạng thái hoàn tiền do người dùng chọn (không auto-resolve theo số tiền/thẻ). */
export function isUserDrivenRefundCondition(ct: RefundFeeRuleConditionType): boolean {
  return ct === "manual" || ct === "advance" || ct === "wait";
}
