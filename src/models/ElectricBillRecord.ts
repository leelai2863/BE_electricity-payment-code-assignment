import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const PeriodSchema = new Schema(
  {
    ky: { type: Number, enum: [1, 2, 3], required: true },
    amount: { type: Number, default: null },
    paymentDeadline: { type: Date, default: null },
    scanDate: { type: Date, default: null },
    scanDdMm: { type: String, default: null },
    ca: { type: String, default: null },
    assignedAgencyId: { type: String, default: null },
    assignedAgencyName: { type: String, default: null },
    dlGiaoName: { type: String, default: null },
    paymentConfirmed: { type: Boolean, default: false },
    cccdConfirmed: { type: Boolean, default: false },
    customerName: { type: String, default: null },
    cardType: { type: String, default: null },
    dealCompletedAt: { type: Date, default: null },
    /** Đồng bộ hạn TT từ AutoCheckEvn (trang chờ giao) */
    evnPaymentDeadlineSyncStatus: { type: String, default: null },
    evnPaymentDeadlineSyncError: { type: String, default: null },
    evnPaymentDeadlineSyncedAt: { type: Date, default: null },
    evnPaymentDeadlineSyncKey: { type: String, default: null },
  },
  { _id: false }
);

const ElectricBillRecordSchema = new Schema(
  {
    customerCode: { type: String, required: true, trim: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, index: true },
    /**
     * Tháng/năm trên kỳ hóa đơn EVN (kyBill.thang / kyBill.nam) khi khác month/year của bản ghi refu.
     * Đồng bộ hạn thanh toán AutoCheck ưu tiên các field này để khớp đúng chu kỳ thông báo.
     */
    evnKyBillThang: { type: Number, min: 1, max: 12, default: null },
    evnKyBillNam: { type: Number, min: 2000, max: 2100, default: null },
    monthLabel: { type: String, default: "" },
    evn: { type: String, default: "EVNCPC" },
    company: { type: String, default: "" },
    periods: { type: [PeriodSchema], default: [] },
    /** Lưu id đại lý dạng string (ObjectId hoặc mã tham chiếu) */
    assignedAgencyId: { type: String, default: null, index: true },
    assignedAgencyName: { type: String, default: null },
    assignedAt: { type: Date, default: null },
    customerName: { type: String, default: null },
    paymentConfirmed: { type: Boolean, default: false },
    cccdConfirmed: { type: Boolean, default: false },
    cardType: { type: String, default: null },
    billingScanJobId: { type: Schema.Types.ObjectId, ref: "BillingScanJob", default: null },
    dealCompletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

ElectricBillRecordSchema.index({ customerCode: 1, year: 1, month: 1 }, { unique: true });
ElectricBillRecordSchema.index({ year: 1, month: 1, customerCode: 1 });
ElectricBillRecordSchema.index({ updatedAt: -1 });
ElectricBillRecordSchema.index({ "periods.assignedAgencyName": 1 });
ElectricBillRecordSchema.index({ "periods.scanDdMm": 1 });
ElectricBillRecordSchema.index({ "periods.paymentDeadline": 1 });
ElectricBillRecordSchema.index({ "periods.dealCompletedAt": 1 });

export type ElectricBillRecordDocument = InferSchemaType<typeof ElectricBillRecordSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ElectricBillRecord: Model<ElectricBillRecordDocument> =
  mongoose.models.ElectricBillRecord ??
  mongoose.model<ElectricBillRecordDocument>("ElectricBillRecord", ElectricBillRecordSchema);
