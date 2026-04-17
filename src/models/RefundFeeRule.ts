import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const RefundFeeRuleSchema = new Schema(
  {
    agencyName: { type: String, required: true, trim: true, index: true },
    feeName: { type: String, default: "", trim: true },
    statusLabel: { type: String, required: true, trim: true, uppercase: true },
    pct: { type: Number, required: true },
    conditionType: {
      type: String,
      enum: ["amount", "cardType", "manual"],
      default: "manual",
      index: true,
    },
    amountMin: { type: Number, default: null },
    amountMax: { type: Number, default: null },
    cardType: { type: String, default: null, trim: true, uppercase: true },
    /** Ngày bắt đầu áp dụng mức phí này (UTC 00:00 của ngày lịch) */
    effectiveFrom: { type: Date, required: true, index: true },
    /** Ngày kết thúc áp dụng (bao gồm cả ngày kết thúc), null = vô thời hạn */
    effectiveTo: { type: Date, default: null, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

RefundFeeRuleSchema.index({ agencyName: 1, isActive: 1, effectiveFrom: -1 });
RefundFeeRuleSchema.index({ agencyName: 1, conditionType: 1, cardType: 1, effectiveFrom: -1 });
RefundFeeRuleSchema.index({ agencyName: 1, statusLabel: 1, effectiveFrom: -1 });

export type RefundFeeRuleDocument = InferSchemaType<typeof RefundFeeRuleSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RefundFeeRule: Model<RefundFeeRuleDocument> =
  mongoose.models.RefundFeeRule ??
  mongoose.model<RefundFeeRuleDocument>("RefundFeeRule", RefundFeeRuleSchema);
