import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const RefundFeeRuleSchema = new Schema(
  {
    agencyName: { type: String, required: true, trim: true, index: true },
    statusLabel: { type: String, required: true, trim: true, uppercase: true },
    pct: { type: Number, required: true },
    /** Ngày bắt đầu áp dụng mức phí này (UTC 00:00 của ngày lịch) */
    effectiveFrom: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

RefundFeeRuleSchema.index({ agencyName: 1, statusLabel: 1, effectiveFrom: -1 });

export type RefundFeeRuleDocument = InferSchemaType<typeof RefundFeeRuleSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RefundFeeRule: Model<RefundFeeRuleDocument> =
  mongoose.models.RefundFeeRule ??
  mongoose.model<RefundFeeRuleDocument>("RefundFeeRule", RefundFeeRuleSchema);
