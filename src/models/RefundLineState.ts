import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const RefundLineStateSchema = new Schema(
  {
    billId: { type: String, required: true, trim: true, index: true },
    ky: { type: Number, enum: [1, 2, 3], required: true },
    /** 0 = dòng kỳ trên hóa đơn; 1|2 = mã con hạ cước (cùng billId+ky, khác dòng hoàn tiền) */
    splitPart: { type: Number, enum: [0, 1, 2], default: 0 },
    agencyName: { type: String, required: true, trim: true, index: true },
    status: { type: String, default: "" },
    /** Snapshot phí % tại thời điểm gán trạng thái — không đổi khi bảng phí nâng sau này */
    phiPct: { type: Number, default: null },
    daHoan: { type: Number, default: 0 },
  },
  { timestamps: true }
);

RefundLineStateSchema.index({ billId: 1, ky: 1, splitPart: 1 }, { unique: true });

export type RefundLineStateDocument = InferSchemaType<typeof RefundLineStateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const RefundLineState: Model<RefundLineStateDocument> =
  mongoose.models.RefundLineState ??
  mongoose.model<RefundLineStateDocument>("RefundLineState", RefundLineStateSchema);
