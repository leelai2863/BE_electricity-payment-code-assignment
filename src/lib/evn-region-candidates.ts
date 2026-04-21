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
  /** Mã Bắc (PA/PH/PM/PN) — AutoCheck NPC; không thử Hà Nội (tránh GET payment-due oan). */
  PA: [REGION_KEYS.BAC],
  PH: [REGION_KEYS.BAC],
  PM: [REGION_KEYS.BAC],
  PN: [REGION_KEYS.BAC],
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
 * Danh sách region cho GET payment-due.
 * - Nếu bill đã có `evn` nhận ra được → **chỉ** vùng đó (tránh PA/NPC bị gọi thêm HANOI).
 * - Không có `evn` → thử theo đầu mã (prefix map).
 */
export function buildPaymentDueRegionCandidates(
  customerCode: string,
  billEvnField: string | undefined | null,
): AutocheckRegionScope[] {
  const primary = billEvnFieldToPrimaryScope(billEvnField);
  if (primary) {
    return [primary];
  }

  const out: AutocheckRegionScope[] = [];
  const push = (r: AutocheckRegionScope) => {
    if (!out.includes(r)) out.push(r);
  };

  const raw = (customerCode ?? "").trim().toUpperCase();
  const prefix = raw.length >= 2 ? raw.slice(0, 2) : "";
  const keys = PREFIX_TO_REGION_KEY_CANDIDATES[prefix];
  if (keys) {
    for (const k of keys) {
      const sc = regionKeyToScope(k);
      if (sc !== UNSUPPORTED_AUTOCHECK_REGION) push(sc);
    }
  }

  // Không fallback "thử cả 3 miền" để tránh spam sai miền (404 hàng loạt) trong production.
  // Nếu không suy ra được miền từ `evn` và prefix mã KH, caller phải xử lý như lỗi định tuyến dữ liệu.
  return out;
}
