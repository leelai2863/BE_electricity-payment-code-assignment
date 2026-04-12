/**
 * Danh sách mã V-GREEN dùng cho npm run seed:vgreen / seed:vouchers (tháng 3/2026).
 * Hạn thanh toán: DD/MM trong tháng 4/2026 (kỳ T3).
 */
export type VgreenScannedRowDef = {
  customerCode: string;
  /** Số nguyên VND (không dấu chấm) */
  amount: number;
  /** DD/MM hoặc null */
  deadlineDdMm: string | null;
};

function isoApril2026(ddMm: string | null): string | null {
  if (!ddMm || !ddMm.includes("/")) return null;
  const [d, m] = ddMm.split("/").map((x) => Number(x.trim()));
  if (!d || !m || Number.isNaN(d) || Number.isNaN(m)) return null;
  return new Date(2026, m - 1, d, 12, 0, 0, 0).toISOString();
}

export const VGREEN_SCANNED_BATCH: VgreenScannedRowDef[] = [
  { customerCode: "PC05II0947012", amount: 15_892_913, deadlineDdMm: "06/04" },
  { customerCode: "PA05040062618", amount: 32_961_427, deadlineDdMm: "09/04" },
  { customerCode: "PC05II0950046", amount: 63_220_388, deadlineDdMm: "06/04" },
  { customerCode: "PB02040000101", amount: 66_626_468, deadlineDdMm: "05/04" },
  { customerCode: "PC05II0948611", amount: 67_071_465, deadlineDdMm: "06/04" },
  { customerCode: "PA07DS0032236", amount: 76_852_476, deadlineDdMm: "08/04" },
  { customerCode: "PM17000100601", amount: 101_823_048, deadlineDdMm: null },
  { customerCode: "PA04DH0039173", amount: 102_038_573, deadlineDdMm: "09/04" },
  { customerCode: "PA16TH0070893", amount: 102_929_895, deadlineDdMm: "10/04" },
  { customerCode: "PNTD003012610", amount: 103_157_911, deadlineDdMm: "07/04" },
  { customerCode: "PA02TN0035072", amount: 103_489_920, deadlineDdMm: "07/04" },
  { customerCode: "PA02LT0018182", amount: 103_846_147, deadlineDdMm: "07/04" },
  { customerCode: "PA02TN0034159", amount: 104_010_048, deadlineDdMm: "07/04" },
  { customerCode: "PA11HL0039074", amount: 104_086_253, deadlineDdMm: "09/04" },
  { customerCode: "PA02PT0027163", amount: 104_195_462, deadlineDdMm: "07/04" },
  { customerCode: "PA23PT0073918", amount: 104_860_224, deadlineDdMm: "10/04" },
  { customerCode: "PA04TP1480282", amount: 105_165_475, deadlineDdMm: "07/04" },
  { customerCode: "PH02000034305", amount: 106_139_419, deadlineDdMm: "06/04" },
  { customerCode: "PA03HL0052419", amount: 106_380_216, deadlineDdMm: "08/04" },
  { customerCode: "PA05090089721", amount: 106_652_765, deadlineDdMm: "09/04" },
];

export function deadlineIsoFromDdMm(ddMm: string | null): string | null {
  return isoApril2026(ddMm);
}
