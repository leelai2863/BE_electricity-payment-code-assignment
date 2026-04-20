import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/** Bắt buộc cho: giao mã, duyệt, gửi mail, và các thao tác nhạy cảm khác */
const AuditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: {
      type: String,
      required: true,
      index: true,
      enum: [
        "voucher.assign",
        "voucher.upload_ocr",
        "voucher.profile_update",
        "voucher.approve",
        "voucher.mail_sent",
        "voucher.status_change",
        "billing_scan.start",
        "billing_scan.complete",
        "billing_scan.approve_staging",
        "billing_scan.approve_staging_batch",
        "billing_scan.revoke_scan_approval",
        "checkbill.ingest_charges_snapshot",
        "electric.assign_agency",
        "electric.invoice_patch",
        "electric.manual_create",
        "agency.create",
        "auth.login",
        "accounting.thu_chi_create",
        "accounting.thu_chi_update",
        "accounting.thu_chi_delete",
        "electric.refund_line_patch",
      ],
    },
    entityType: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

AuditLogSchema.index({ createdAt: -1 });

export type AuditLogDocument = InferSchemaType<typeof AuditLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AuditLog: Model<AuditLogDocument> =
  mongoose.models.AuditLog ?? mongoose.model<AuditLogDocument>("AuditLog", AuditLogSchema);
