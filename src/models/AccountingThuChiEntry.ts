import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const HaCuocContextSchema = new Schema(
  {
    kind: { type: String, enum: ["HA_CUOC"], required: true },
    customerCode: { type: String, required: true, trim: true, uppercase: true },
    targetBillId: { type: String, required: true },
    targetKy: { type: Number, enum: [1, 2, 3], required: true },
    targetYear: { type: Number, required: true },
    targetMonth: { type: Number, required: true },
    originalAmount: { type: Number, required: true },
    splitAmount1: { type: Number, required: true },
    /** SplitBillEntry._id */
    createdSplitEntryId: { type: String, default: null },
    /** Dòng Thu chi thứ 2: chỉ đánh dấu đã trả split2, không tạo split mới */
    resolvedExistingSplit: { type: Boolean, default: false },
  },
  { _id: false }
);

const AccountingThuChiEntrySchema = new Schema(
  {
    /** Ngày giao dịch (theo nghiệp vụ kế toán) */
    txnDate: { type: Date, required: true, index: true },
    /** Ngày thanh toán thực tế dùng để ghép phân bổ Hoàn tiền (nếu nhập trễ so với ngày hạch toán). */
    effectivePaymentDate: { type: Date, default: null, index: true },
    /** Nội dung */
    description: { type: String, default: "", trim: true },
    /** Nguồn — nếu trùng mã đại lý (Agency.code) và có Chi thì dùng cho phân bổ Hoàn tiền */
    source: { type: String, default: "", trim: true, index: true },
    bank: { type: String, default: "", trim: true },
    thu: { type: Number, default: null },
    chi: { type: Number, default: null },
    notes: { type: String, default: "", trim: true },
    linkedAgencyId: { type: Schema.Types.ObjectId, ref: "Agency", default: null, index: true },
    linkedAgencyCode: { type: String, default: null, trim: true, uppercase: true },
    linkedAgencyName: { type: String, default: null, trim: true },
    /** Liên kết tách hóa đơn (Hạ Cước từ Thu chi) */
    haCuocContext: { type: HaCuocContextSchema, default: null },
  },
  { timestamps: true }
);

AccountingThuChiEntrySchema.index({ txnDate: -1, _id: -1 });
AccountingThuChiEntrySchema.index({ "haCuocContext.createdSplitEntryId": 1 });

export type AccountingThuChiEntryDocument = InferSchemaType<typeof AccountingThuChiEntrySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AccountingThuChiEntry: Model<AccountingThuChiEntryDocument> =
  mongoose.models.AccountingThuChiEntry ??
  mongoose.model<AccountingThuChiEntryDocument>("AccountingThuChiEntry", AccountingThuChiEntrySchema);
