/**
 * Thứ tự vùng thử theo đầu mã KH (đồng bộ logic với tool-check-bill Shopee routing).
 * AutoCheckEvn hiện: EVN_CPC (Trung), EVN_NPC (Bắc), EVN_HANOI — Nam/HCM sẽ bổ sung sau.
 */

const REGION_KEYS = {
  TRUNG: "TRUNG",
  NAM: "NAM",
  HCM: "HCM",
  HN: "HN",
  BAC: "BAC",
} as const;

/** Prefix 2 ký tự đầu (sau trim + upper) → thứ tự thử vùng logic */
const PREFIX_TO_REGION_KEY_CANDIDATES: Record<string, readonly string[]> = {
  PC: [REGION_KEYS.TRUNG, REGION_KEYS.NAM],
  PP: [REGION_KEYS.TRUNG, REGION_KEYS.NAM],
  PQ: [REGION_KEYS.TRUNG, REGION_KEYS.NAM],
  PB: [REGION_KEYS.NAM, REGION_KEYS.TRUNG, REGION_KEYS.HCM],
  PK: [REGION_KEYS.NAM, REGION_KEYS.TRUNG, REGION_KEYS.HCM],
  PE: [REGION_KEYS.HCM, REGION_KEYS.NAM],
  HN: [REGION_KEYS.HN, REGION_KEYS.BAC],
  PD: [REGION_KEYS.HN, REGION_KEYS.BAC],
  PA: [REGION_KEYS.BAC, REGION_KEYS.HN],
  PH: [REGION_KEYS.BAC, REGION_KEYS.HN],
  PM: [REGION_KEYS.BAC, REGION_KEYS.HN],
  PN: [REGION_KEYS.BAC, REGION_KEYS.HN],
};

export type AutocheckRegionScope = "EVN_CPC" | "EVN_NPC" | "EVN_HANOI";

/** Vùng chưa có API/tenant trên AutoCheckEvn — chỉ để báo lỗi rõ, không gọi HTTP. */
const UNSUPPORTED_AUTOCHECK_REGION = "__UNSUPPORTED__" as const;

function regionKeyToScope(key: string): AutocheckRegionScope | typeof UNSUPPORTED_AUTOCHECK_REGION {
  switch (key) {
    case REGION_KEYS.TRUNG:
      return "EVN_CPC";
    case REGION_KEYS.BAC:
      return "EVN_NPC";
    case REGION_KEYS.HN:
      return "EVN_HANOI";
    case REGION_KEYS.NAM:
    case REGION_KEYS.HCM:
      return UNSUPPORTED_AUTOCHECK_REGION;
    default:
      return UNSUPPORTED_AUTOCHECK_REGION;
  }
}

/** Chuẩn hoá field `evn` trên hóa đơn refu → scope AutoCheck (nếu nhận diện được). */
export function billEvnFieldToPrimaryScope(evnRaw: string | undefined | null): AutocheckRegionScope | null {
  const s = (evnRaw ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!s) return null;
  if (s.includes("HANOI") || s === "HANOI") return "EVN_HANOI";
  if (s.includes("NPC") || s === "EVNNPC" || s === "NPC") return "EVN_NPC";
  if (s.includes("CPC") || s === "EVNCPC" || s === "CPC") return "EVN_CPC";
  if (s === "EVN_HANOI") return "EVN_HANOI";
  if (s === "EVN_NPC") return "EVN_NPC";
  if (s === "EVN_CPC") return "EVN_CPC";
  return null;
}

/**
 * Danh sách region query cho GET payment-due (thứ tự ưu tiên).
 * - Ưu tiên `evn` đã lưu trên bill (từ job quét).
 * - Sau đó thử theo đầu mã (fallback khi evn sai / trống).
 */
export function buildPaymentDueRegionCandidates(
  customerCode: string,
  billEvnField: string | undefined | null,
): AutocheckRegionScope[] {
  const out: AutocheckRegionScope[] = [];
  const push = (r: AutocheckRegionScope) => {
    if (!out.includes(r)) out.push(r);
  };

  const primary = billEvnFieldToPrimaryScope(billEvnField);
  if (primary) push(primary);

  const raw = (customerCode ?? "").trim().toUpperCase();
  const prefix = raw.length >= 2 ? raw.slice(0, 2) : "";
  const keys = PREFIX_TO_REGION_KEY_CANDIDATES[prefix];
  if (keys) {
    for (const k of keys) {
      const sc = regionKeyToScope(k);
      if (sc !== UNSUPPORTED_AUTOCHECK_REGION) push(sc);
    }
  }

  if (out.length === 0) {
    push("EVN_CPC");
    push("EVN_NPC");
    push("EVN_HANOI");
  }
  return out;
}
