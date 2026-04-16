import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const CheckbillIngestItemSchema = new Schema(
  {
    nguon: { type: String, required: true, trim: true },
    maKh: { type: String, required: true, trim: true, index: true },
    soTienDisplay: { type: String, default: "" },
    soTienVnd: { type: Number, required: true, min: 0, index: true },
    tenKh: { type: String, default: "" },
  },
  { _id: false }
);

const CheckbillIngestBatchSchema = new Schema(
  {
    eventType: { type: String, required: true, trim: true },
    eventAt: { type: Date, required: true, index: true },
    projectId: { type: String, default: "checkbill", trim: true },
    jobId: { type: String, required: true, trim: true, index: true, unique: true },
    snapshotId: { type: Number, default: null, index: true, unique: true, sparse: true },
    jobSource: { type: String, default: null },
    jobStatus: { type: String, default: null },
    completedAt: { type: Date, default: null, index: true },
    comparison: { type: String, default: null },
    deltaRowCount: { type: Number, default: 0 },
    snapshotRowCount: { type: Number, default: 0 },
    deltaTotalAmountVnd: { type: Number, default: 0 },
    totalAmountVnd: { type: Number, default: 0 },
    itemsDeltaTruncated: { type: Boolean, default: false },
    downloadExcelUrl: { type: String, default: null },
    /** True when POST items were truncated (tool-check-bill contract). */
    itemsTruncated: { type: Boolean, default: false },
    /** Row count before dedupe, after optional full JSON fetch. */
    rawRowCount: { type: Number, default: 0 },
    dedupeUniqueCount: { type: Number, default: 0 },
    dedupeDuplicateCount: { type: Number, default: 0 },
    items: { type: [CheckbillIngestItemSchema], default: [] },
    processStatus: {
      type: String,
      enum: ["received", "processing", "processed", "failed"],
      default: "received",
      index: true,
    },
    receivedAt: { type: Date, required: true, default: Date.now, index: true },
    processedAt: { type: Date, default: null },
    processSummary: {
      processedCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
      errorMessage: { type: String, default: null },
    },
  },
  { timestamps: true }
);

CheckbillIngestBatchSchema.index({ jobId: 1, receivedAt: -1 });
CheckbillIngestBatchSchema.index({ processStatus: 1, receivedAt: -1 });

export type CheckbillIngestBatchDocument = InferSchemaType<typeof CheckbillIngestBatchSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const CheckbillIngestBatch: Model<CheckbillIngestBatchDocument> =
  mongoose.models.CheckbillIngestBatch ??
  mongoose.model<CheckbillIngestBatchDocument>("CheckbillIngestBatch", CheckbillIngestBatchSchema);
