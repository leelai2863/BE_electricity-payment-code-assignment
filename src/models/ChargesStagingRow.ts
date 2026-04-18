import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const ChargesStagingRowSchema = new Schema(
  {
    dedupeHash: { type: String, required: true, trim: true, index: true, unique: true },
    nguon: { type: String, required: true, trim: true },
    maKh: { type: String, required: true, trim: true, index: true },
    soTienDisplay: { type: String, default: "" },
    soTienVnd: { type: Number, required: true, min: 0 },
    tenKh: { type: String, default: "" },
    /** Từ ingest (kyBill) — chỉ khi tool gửi đủ cặp hợp lệ */
    evnKyBillThang: { type: Number, min: 1, max: 12, default: null },
    evnKyBillNam: { type: Number, min: 2000, max: 2100, default: null },
    jobId: { type: String, required: true, trim: true, index: true },
    snapshotId: { type: Number, default: null, index: true },
    ingestBatchId: { type: Schema.Types.ObjectId, ref: "CheckbillIngestBatch", required: true, index: true },
    snapshotCompletedAt: { type: Date, default: null },
    receivedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true }
);

ChargesStagingRowSchema.index({ receivedAt: -1 });
ChargesStagingRowSchema.index({ ingestBatchId: 1, dedupeHash: 1 });

export type ChargesStagingRowDocument = InferSchemaType<typeof ChargesStagingRowSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ChargesStagingRow: Model<ChargesStagingRowDocument> =
  mongoose.models.ChargesStagingRow ??
  mongoose.model<ChargesStagingRowDocument>("ChargesStagingRow", ChargesStagingRowSchema);
