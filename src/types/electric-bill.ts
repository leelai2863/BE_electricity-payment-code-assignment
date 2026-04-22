export type CaSlot = "10h" | "16h" | "24h";

export type ElectricBillPeriod = {
  ky: 1 | 2 | 3;
  amount: number | null;
  paymentDeadline: string | null;
  /** Legacy ISO từ job quét — UI ưu tiên scanDdMm */
  scanDate: string | null;
  /** Ngày thanh toán theo kỳ, dd/mm (không năm); không tự điền từ quét */
  scanDdMm: string | null;
  ca: CaSlot | null;
  assignedAgencyId: string | null;
  assignedAgencyName: string | null;
  dlGiaoName: string | null;
  paymentConfirmed: boolean;
  cccdConfirmed: boolean;
  customerName: string | null;
  cardType: string | null;
  /** Hoàn tất giao dịch theo kỳ — Đi mail */
  dealCompletedAt: string | null;
  /** Trạng thái đồng bộ hạn TT từ AutoCheckEvn (trang chưa giao) */
  evnPaymentDeadlineSyncStatus?:
    | "pending"
    | "running"
    | "ok"
    | "no_data"
    | "error"
    | "unsupported"
    | string
    | null;
  evnPaymentDeadlineSyncError?: string | null;
  evnPaymentDeadlineSyncedAt?: string | null;
  /** Fingerprint lần đồng bộ thành công (year-month-ky-amount) — chu kỳ mới đổi amount → gọi lại */
  evnPaymentDeadlineSyncKey?: string | null;
};

export type ElectricBillDto = {
  _id: string;
  customerCode: string;
  month: number;
  year: number;
  /** kyBill.thang trên EVN khi khác `month` (ví dụ refu theo tháng duyệt quét) — dùng cho AutoCheck payment-due */
  evnKyBillThang?: number | null;
  /** kyBill.nam trên EVN khi khác `year` */
  evnKyBillNam?: number | null;
  monthLabel: string;
  evn: string;
  company: string;
  periods: ElectricBillPeriod[];
  /** Giao mã (tổng); chi tiết theo kỳ nằm trong periods */
  assignedAgencyId: string | null;
  assignedAgencyName: string | null;
  assignedAt: string | null;
  /** Legacy — ưu tiên dữ liệu trong từng period */
  customerName: string | null;
  paymentConfirmed: boolean;
  cccdConfirmed: boolean;
  cardType: string | null;
  dealCompletedAt: string | null;
};

export type BillingScanHistoryRow = {
  _id: string;
  customerCode: string;
  amount: number | null;
  status: "has_bill" | "no_bill";
  scannedAt: string;
  jobId: string | null;
};

export type AgencyOption = {
  id: string;
  name: string;
  code: string;
};

export type RefundFeeRuleDto = {
  _id: string;
  agencyName: string;
  feeName: string;
  statusLabel: string;
  conditionType: "amount" | "cardType" | "manual" | "fixed" | "advance" | "wait";
  amountMin: number | null;
  amountMax: number | null;
  cardType: string | null;
  pct: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
};

export type RefundLineStateDto = {
  billId: string;
  ky: 1 | 2 | 3;
  /** 0 = dòng kỳ hóa đơn; 1|2 = mã con hạ cước */
  splitPart?: 0 | 1 | 2;
  agencyName: string;
  status: string;
  phiPct: number | null;
  daHoan: number;
  updatedAt: string;
  /**
   * Phân bổ từ bảng thu chi: khi Nguồn khớp mã đại lý (Agency.code), tổng cột Chi của đại lý
   * được chia theo tỷ lệ (Số tiền − Thành phí) từng dòng hoàn tiền. Chỉ gắn trong GET mail-queue.
   */
  daHoanFromThuChi?: number;
  /** daHoan (Mongo / nhập tay) + (daHoanFromThuChi ?? 0) */
  daHoanTotal?: number;
};

/** Một dòng đã hoàn tất (theo kỳ) cho trang Đi mail / Hoàn tiền */
export type MailQueueLineDto = {
  billId: string;
  customerCode: string;
  monthLabel: string;
  /** Tháng hóa đơn (1–12) — neo ngày cho mức phí hoàn tiền */
  month: number;
  year: number;
  company: string;
  ky: 1 | 2 | 3;
  amount: number | null;
  assignedAgencyName: string | null;
  /** Ca thanh toán theo kỳ (cùng nguồn với Danh sách hóa đơn) */
  ca: CaSlot | null;
  dlGiaoName: string | null;
  customerName: string | null;
  /** Ngày thanh toán nhập trên Danh sách hóa đơn (dd/mm), theo kỳ — không dùng dealCompletedAt */
  scanDdMm: string | null;
  cardType: string | null;
  resolvedStatus: string | null;
  resolvedPhiPct: number | null;
  dealCompletedAt: string;
  /** 0 hoặc không có: dòng kỳ trên hóa đơn; 1|2: mã con hạ cước (chỉ Hoàn tiền) */
  splitPart?: 0 | 1 | 2;
  /** true: ẩn ở trang Gửi mail / xuất Excel mail; chỉ dùng Hoàn tiền */
  refundOnly?: boolean;
};
