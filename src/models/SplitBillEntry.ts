import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const SplitPeriodSchema = new Schema(
  {
    amount: { type: Number, required: true },
    assignedAgencyId: { type: String, default: null },
    assignedAgencyName: { type: String, default: null },
    dlGiaoName: { type: String, default: null },
    paymentConfirmed: { type: Boolean, default: false },
    cccdConfirmed: { type: Boolean, default: false },
    customerName: { type: String, default: null },
    cardType: { type: String, default: null },
    scanDdMm: { type: String, default: null },
    ca: { type: String, default: null },
    paymentDeadline: { type: Date, default: null },
    dealCompletedAt: { type: Date, default: null },
  },
  { _id: false }
);

const SplitBillEntrySchema = new Schema(
  {
    originalBillId: { type: String, required: true, index: true },
    originalKy: { type: Number, enum: [1, 2, 3], required: true },
    customerCode: { type: String, required: true, index: true },
    monthLabel: { type: String, default: "" },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    originalAmount: { type: Number, required: true },
    split1: { type: SplitPeriodSchema, required: true },
    split2: { type: SplitPeriodSchema, required: true },
    status: { type: String, enum: ["active", "resolved", "cancelled"], default: "active" },
    resolvedAt: { type: Date, default: null },
    createdBy: { type: String, enum: ["manual", "thu-chi"], default: "manual" },
    sourceThuChiId: { type: String, default: null, index: true },
    lockedByThuChi: { type: Boolean, default: false },
    /** Lưu trước khi detach kỳ cha (Thu chi) — dùng khôi phục khi hủy tách từ Danh sách HĐ. */
    parentAgencyBeforeHaCuoc: {
      assignedAgencyId: { type: String, default: null },
      assignedAgencyName: { type: String, default: null },
      dlGiaoName: { type: String, default: null },
    },
  },
  { timestamps: true }
);

SplitBillEntrySchema.index({ originalBillId: 1, status: 1 });
SplitBillEntrySchema.index({ originalBillId: 1, originalKy: 1, status: 1 });

export type SplitBillEntryDocument = InferSchemaType<typeof SplitBillEntrySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SplitBillEntry: Model<SplitBillEntryDocument> =
  mongoose.models.SplitBillEntry ??
  mongoose.model<SplitBillEntryDocument>("SplitBillEntry", SplitBillEntrySchema);
