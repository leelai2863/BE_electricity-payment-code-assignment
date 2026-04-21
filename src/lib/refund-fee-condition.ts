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

/** Alias từ snake_case / biến thể (tránh lệch với camelCase `cardType`). */
const CONDITION_ALIASES: Record<string, RefundFeeRuleConditionType> = {
  card_type: "cardType",
};

/**
 * Chuẩn hóa `conditionType` từ body API / Mongo.
 *
 * Lỗi đã gặp: FE gửi `"cardType"` → so sánh sau `.toLowerCase()` thành `"cardtype"`
 * nhưng danh sách cho phép chỉ có `"cardType"` → không khớp → fallback `"manual"` (TỰ DO trên UI).
 * Cần so khớp không phân biệt hoa thường với **giá trị chuẩn** (canonical), không với chuỗi đã lower toàn bộ.
 */
export function normalizeRefundFeeConditionInput(
  value: unknown,
  fallback: RefundFeeRuleConditionType
): RefundFeeRuleConditionType {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const key = raw.toLowerCase().replace(/-/g, "_");
  const alias = CONDITION_ALIASES[key];
  if (alias) return alias;
  for (const ct of ALLOWED) {
    if (ct.toLowerCase() === raw.toLowerCase()) return ct;
  }
  return fallback;
}

/** Trạng thái hoàn tiền do người dùng chọn (không auto-resolve theo số tiền/thẻ). */
export function isUserDrivenRefundCondition(ct: RefundFeeRuleConditionType): boolean {
  return ct === "manual" || ct === "advance" || ct === "wait";
}
