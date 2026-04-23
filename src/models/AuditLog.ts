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
        "electric.bill_reset_period_superadmin",
        "electric.manual_create",
        "electric.ha_cuoc_apply",
        "electric.ha_cuoc_adjust",
        "electric.ha_cuoc_revert",
        "electric.pending_mark",
        "electric.pending_resolve",
        "electric.pending_upload_image",
        "electric.refund_fee_rule_create",
        "electric.refund_fee_rule_update",
        "electric.refund_fee_rule_delete",
        "electric.split_patch",
        "electric.payment_deadline_sync_enqueue",
        "electric.refund_migrate_localstorage",
        "electric.split_manual_disabled_attempt",
        "agency.create",
        "agency.update",
        "agency.delete",
        "customer_account.import",
        "customer_account.update",
        "customer_account.delete",
        "dev_tools.purge_mock_data",
        "billing_scan.deprecated_job_access",
        "auth.login",
        "accounting.thu_chi_create",
        "accounting.thu_chi_update",
        "accounting.thu_chi_delete",
        "accounting.thu_chi_bank_catalog_create",
        "accounting.thu_chi_bank_catalog_update",
        "accounting.thu_chi_bank_catalog_delete",
        "accounting.thu_chi_source_catalog_create",
        "accounting.thu_chi_source_catalog_update",
        "accounting.thu_chi_source_catalog_delete",
        "electric.refund_line_patch",
        "electric.data_export",
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
