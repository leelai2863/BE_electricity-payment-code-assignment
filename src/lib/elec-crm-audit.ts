import type { Types } from "mongoose";
import { getSharedLogger } from "@core-x/shared-logger";
import type { AuditAction } from "@/lib/audit-types";

/** Actor cố định cho thao tác hệ thống (ingest checkbill — không có user IAM). */
export const ELEC_SYSTEM_AUDIT_ACTOR_ID = "000000000000000000000001";

function auditActionForCentral(mongoAction: AuditAction): string {
  const map: Partial<Record<AuditAction, string>> = {
    "electric.assign_agency": "elec.assign_agency",
    "electric.invoice_patch": "elec.invoice_patch",
    "electric.bill_reset_period_superadmin": "elec.bill_reset_period_superadmin",
    "electric.manual_create": "elec.manual_create",
    "electric.ha_cuoc_apply": "elec.ha_cuoc.apply",
    "electric.ha_cuoc_adjust": "elec.ha_cuoc.adjust",
    "electric.ha_cuoc_revert": "elec.ha_cuoc.revert",
    "electric.pending_mark": "elec.pending.mark",
    "electric.pending_resolve": "elec.pending.resolve",
    "electric.pending_upload_image": "elec.pending.upload_image",
    "electric.refund_fee_rule_create": "elec.refund_fee_rule.create",
    "electric.refund_fee_rule_update": "elec.refund_fee_rule.update",
    "electric.refund_fee_rule_delete": "elec.refund_fee_rule.delete",
    "electric.split_patch": "elec.split.patch",
    "electric.payment_deadline_sync_enqueue": "elec.payment_deadline_sync.enqueue",
    "electric.refund_migrate_localstorage": "elec.refund_migrate_localstorage",
    "electric.split_manual_disabled_attempt": "elec.split.manual_disabled_attempt",
    "voucher.assign": "elec.voucher.assign",
    "voucher.upload_ocr": "elec.voucher.upload_ocr",
    "voucher.profile_update": "elec.voucher.profile_update",
    "voucher.approve": "elec.voucher.approve",
    "voucher.mail_sent": "elec.voucher.mail_sent",
    "voucher.status_change": "elec.voucher.status_change",
    "billing_scan.start": "elec.billing_scan.start",
    "billing_scan.complete": "elec.billing_scan.complete",
    "billing_scan.approve_staging": "elec.billing_scan.approve_staging",
    "billing_scan.approve_staging_batch": "elec.billing_scan.approve_staging_batch",
    "billing_scan.revoke_scan_approval": "elec.billing_scan.revoke_scan_approval",
    "checkbill.ingest_charges_snapshot": "elec.checkbill.ingest_charges_snapshot",
    "agency.create": "elec.agency.create",
    "agency.update": "elec.agency.update",
    "agency.delete": "elec.agency.delete",
    "customer_account.import": "elec.customer_account.import",
    "customer_account.update": "elec.customer_account.update",
    "customer_account.delete": "elec.customer_account.delete",
    "dev_tools.purge_mock_data": "elec.dev_tools.purge_mock_data",
    "billing_scan.deprecated_job_access": "elec.billing_scan.deprecated_job_access",
    "auth.login": "elec.auth.login",
    "accounting.thu_chi_create": "elec.accounting.thu_chi_create",
    "accounting.thu_chi_update": "elec.accounting.thu_chi_update",
    "accounting.thu_chi_delete": "elec.accounting.thu_chi_delete",
    "accounting.thu_chi_bank_catalog_create": "elec.accounting.thu_chi_bank_catalog_create",
    "accounting.thu_chi_bank_catalog_update": "elec.accounting.thu_chi_bank_catalog_update",
    "accounting.thu_chi_bank_catalog_delete": "elec.accounting.thu_chi_bank_catalog_delete",
    "accounting.thu_chi_source_catalog_create": "elec.accounting.thu_chi_source_catalog_create",
    "accounting.thu_chi_source_catalog_update": "elec.accounting.thu_chi_source_catalog_update",
    "accounting.thu_chi_source_catalog_delete": "elec.accounting.thu_chi_source_catalog_delete",
    "electric.refund_line_patch": "elec.refund.line_patch",
    "electric.data_export": "elec.data_export",
  };
  return map[mongoAction] ?? `elec.${mongoAction}`;
}

function buildViSummary(
  mongoAction: AuditAction,
  meta: Record<string, unknown>,
  entityType: string
): string {
  const m = meta ?? {};
  switch (mongoAction) {
    case "electric.assign_agency":
      return `Giao mã điện ${String(m.customerCode ?? "")} cho đại lý «${String(m.agencyName ?? m.agencyId ?? "")}».`;
    case "electric.invoice_patch": {
      const code = String(m.customerCode ?? "").trim();
      const fields = Array.isArray(m.patchedFields) ? (m.patchedFields as string[]).join(", ") : "";
      return code
        ? `Cập nhật hóa đơn điện mã KH ${code}${fields ? ` (${fields})` : ""}.`
        : `Cập nhật hóa đơn điện (${entityType}).`;
    }
    case "electric.bill_reset_period_superadmin": {
      const code = String(m.customerCode ?? "").trim();
      const rk = m.resetPeriodKy;
      return code
        ? `SUPER_ADMIN gỡ toàn bộ dữ liệu kỳ ${rk != null ? String(rk) : "?"} (mã KH ${code}).`
        : `SUPER_ADMIN gỡ dữ liệu một kỳ (${entityType}).`;
    }
    case "electric.manual_create": {
      const code = String(m.customerCode ?? "").trim();
      const mo = m.month != null && m.year != null ? ` tháng ${m.month}/${m.year}` : "";
      return code ? `Thêm hóa đơn tay mã KH ${code}${mo}.` : `Thêm hóa đơn tay (${entityType}).`;
    }
    case "electric.ha_cuoc_apply": {
      const code = String(m.customerCode ?? "").trim();
      const ky = m.targetKy != null ? ` kỳ ${String(m.targetKy)}` : "";
      const chi = m.chiVnd != null ? `, chi ${Number(m.chiVnd).toLocaleString("vi-VN")} đ` : "";
      return `Hạ cước — tạo/gắn Thu chi${code ? ` cho mã ${code}` : ""}${ky}${chi}.`;
    }
    case "electric.ha_cuoc_adjust": {
      const code = String(m.customerCode ?? "").trim();
      const before = m.prevSplitAmount1 != null ? Number(m.prevSplitAmount1) : null;
      const after = m.nextSplitAmount1 != null ? Number(m.nextSplitAmount1) : null;
      const delta =
        before != null && after != null
          ? ` (chi đợt 1 ${before.toLocaleString("vi-VN")} → ${after.toLocaleString("vi-VN")} đ)`
          : "";
      return `Hạ cước — điều chỉnh Thu chi${code ? ` mã ${code}` : ""}${delta}.`;
    }
    case "electric.ha_cuoc_revert": {
      const code = String(m.customerCode ?? "").trim();
      const omitted = Boolean(m.omittedIrreversible);
      return omitted
        ? `Hạ cước — xóa Thu chi và bỏ qua hoàn tác split đã chốt${code ? ` (mã ${code})` : ""}.`
        : `Hạ cước — hoàn tác liên kết split khi sửa/xóa Thu chi${code ? ` (mã ${code})` : ""}.`;
    }
    case "electric.pending_mark": {
      const code = String(m.customerCode ?? "").trim();
      return `Mã treo — đánh dấu treo${code ? ` (${code})` : ""}${m.note ? `: ${String(m.note)}` : ""}.`;
    }
    case "electric.pending_resolve": {
      const code = String(m.customerCode ?? "").trim();
      return `Mã treo — giải treo${code ? ` (${code})` : ""}.`;
    }
    case "electric.pending_upload_image": {
      const code = String(m.customerCode ?? "").trim();
      const field = String(m.imageField ?? "").trim();
      return `Mã treo — tải ảnh ${field || "chứng từ"}${code ? ` cho mã ${code}` : ""}.`;
    }
    case "electric.refund_fee_rule_create":
      return `Hoàn phí — tạo rule phí cho đại lý «${String(m.agencyName ?? "")}».`;
    case "electric.refund_fee_rule_update":
      return `Hoàn phí — cập nhật rule phí ${String(m.ruleId ?? "")}.`;
    case "electric.refund_fee_rule_delete":
      return `Hoàn phí — xóa rule phí ${String(m.ruleId ?? "")}.`;
    case "electric.split_patch":
      return `Hạ cước — cập nhật split ${String(m.splitId ?? "")} phần ${String(m.splitIdx ?? "")}.`;
    case "electric.payment_deadline_sync_enqueue": {
      const targeted = Boolean(m.targeted);
      const enq = Number(m.enqueued ?? 0);
      const dup = Number(m.duplicate ?? 0);
      const skipped = Number(m.skipped ?? 0);
      const cool = Number(m.cooldown ?? 0);
      return targeted
        ? `Hàng chờ giao mã — xếp hàng đồng bộ hạn TT theo kỳ đích (queued ${enq}, duplicate ${dup}, skipped ${skipped}, cooldown ${cool}).`
        : `Hàng chờ giao mã — xếp hàng đồng bộ hạn TT hàng loạt (queued ${enq}, duplicate ${dup}, skipped ${skipped}, cooldown ${cool}).`;
    }
    case "electric.refund_migrate_localstorage":
      return `Hoàn tiền — migrate dữ liệu localStorage (rules ${Number(m.rulesInserted ?? 0)}, line states ${Number(m.lineStatesUpserted ?? 0)}).`;
    case "electric.split_manual_disabled_attempt":
      return "Từ chối tách mã thủ công (đã tắt, chỉ cho phép qua Thu chi Hạ cước).";
    case "voucher.upload_ocr": {
      const fc = Array.isArray(m.fields) ? m.fields.length : Number(m.fieldsCount ?? 0) || 0;
      return `OCR / trích xuất voucher (${fc} trường).`;
    }
    case "voucher.profile_update":
      return "Cập nhật hồ sơ voucher thủ công.";
    case "voucher.approve":
      return "Duyệt voucher.";
    case "voucher.mail_sent":
      return "Đánh dấu đã gửi mail voucher.";
    case "voucher.status_change":
      return "Đổi trạng thái voucher.";
    case "voucher.assign":
      return "Gán voucher.";
    case "billing_scan.approve_staging": {
      const code = String(m.customerCode ?? "").trim();
      const skipped = Boolean(m.skippedDuplicate);
      if (skipped) return `Duyệt dòng quét cước staging — bỏ qua (trùng bảng đã giao)${code ? `: ${code}` : ""}.`;
      return `Duyệt dòng quét cước vào hóa đơn${code ? ` (mã KH ${code})` : ""}.`;
    }
    case "billing_scan.approve_staging_batch": {
      const approved = Number(m.approved ?? 0);
      const requested = Number(m.requested ?? 0);
      return `Duyệt hàng loạt quét cước: ${approved}/${requested} dòng thành công.`;
    }
    case "billing_scan.revoke_scan_approval": {
      const code = String(m.customerCode ?? "").trim();
      const deleted = Boolean(m.billDeleted);
      return deleted
        ? `Hủy duyệt quét cước — xóa hóa đơn${code ? ` (${code})` : ""}, khôi phục staging.`
        : `Hủy duyệt quét cước — gỡ kỳ quét, khôi phục staging${code ? ` (${code})` : ""}.`;
    }
    case "checkbill.ingest_charges_snapshot": {
      const job = String(m.jobId ?? "").trim();
      const n = Number(m.itemsAccepted ?? 0);
      return `Tiếp nhận snapshot cước từ tool checkbill${job ? ` (job ${job})` : ""}: ${n} dòng mới vào staging.`;
    }
    case "billing_scan.start":
      return "Bắt đầu job quét cước (deprecated).";
    case "billing_scan.complete":
      return "Hoàn tất job quét cước (deprecated).";
    case "agency.create":
      return "Tạo đại lý.";
    case "agency.update":
      return `Cập nhật đại lý (${String(m.agencyId ?? "")}).`;
    case "agency.delete":
      return `Xóa mềm đại lý (${String(m.agencyId ?? "")}).`;
    case "customer_account.import":
      return `Import tài khoản khách hàng (${Number(m.totalCount ?? 0)} dòng).`;
    case "customer_account.update":
      return `Cập nhật tài khoản khách hàng (${String(m.accountId ?? "")}).`;
    case "customer_account.delete":
      return `Xóa tài khoản khách hàng (${String(m.accountId ?? "")}).`;
    case "dev_tools.purge_mock_data":
      return `Dev tools — purge mock data (${Number(m.collectionsAffected ?? 0)} collections).`;
    case "billing_scan.deprecated_job_access":
      return "Truy cập endpoint billing scan jobs đã deprecated.";
    case "auth.login":
      return "Đăng nhập (elec).";
    case "accounting.thu_chi_create": {
      const src = String(m.source ?? "").trim();
      const thu = m.thuVnd != null ? `Thu ${Number(m.thuVnd).toLocaleString("vi-VN")} đ` : "";
      const chi = m.chiVnd != null ? `Chi ${Number(m.chiVnd).toLocaleString("vi-VN")} đ` : "";
      const neo = String(m.linkedAgencyCode ?? "").trim();
      const parts = [thu, chi].filter(Boolean).join(", ");
      return `Kế toán — thêm dòng thu chi${parts ? ` (${parts})` : ""}${src ? `, nguồn «${src}»` : ""}${neo ? `, neo đại lý ${neo}` : ""}.`;
    }
    case "accounting.thu_chi_update": {
      const id = String(m.entryId ?? "").trim();
      return `Kế toán — sửa dòng thu chi${id ? ` (${id})` : ""}: ${String(m.changeSummary ?? "chi tiết trong metadata")}.`;
    }
    case "accounting.thu_chi_delete": {
      const id = String(m.entryId ?? "").trim();
      return `Kế toán — xóa dòng thu chi${id ? ` (${id})` : ""}.`;
    }
    case "accounting.thu_chi_bank_catalog_create":
      return `Kế toán — thêm danh mục ngân hàng thu chi (${String(m.bank ?? "")}).`;
    case "accounting.thu_chi_bank_catalog_update":
      return `Kế toán — sửa danh mục ngân hàng thu chi (${String(m.entryId ?? "")}).`;
    case "accounting.thu_chi_bank_catalog_delete":
      return `Kế toán — xóa danh mục ngân hàng thu chi (${String(m.entryId ?? "")}).`;
    case "accounting.thu_chi_source_catalog_create":
      return `Kế toán — thêm danh mục nguồn thu chi (${String(m.source ?? "")}).`;
    case "accounting.thu_chi_source_catalog_update":
      return `Kế toán — sửa danh mục nguồn thu chi (${String(m.entryId ?? "")}).`;
    case "accounting.thu_chi_source_catalog_delete":
      return `Kế toán — xóa danh mục nguồn thu chi (${String(m.entryId ?? "")}).`;
    case "electric.refund_line_patch": {
      const mkh = String(m.customerCode ?? "").trim();
      const ky = m.ky != null ? ` kỳ ${m.ky}` : "";
      const prev = m.prevDaHoan != null ? Number(m.prevDaHoan) : null;
      const next = m.nextDaHoan != null ? Number(m.nextDaHoan) : null;
      const fromTc = m.daHoanThuChiSnapshot != null ? Number(m.daHoanThuChiSnapshot) : null;
      let money = "";
      if (prev != null && next != null && prev !== next) {
        money = ` Đã hoàn (nhập tay) ${prev.toLocaleString("vi-VN")} → ${next.toLocaleString("vi-VN")} đ.`;
      }
      if (fromTc != null && fromTc > 0) {
        money += ` Phân bổ từ thu chi tại thời điểm lưu: ${fromTc.toLocaleString("vi-VN")} đ.`;
      }
      return `Hoàn tiền — cập nhật dòng${mkh ? ` mã KH ${mkh}` : ""}${ky}.${money}`;
    }
    case "electric.data_export": {
      const kind = String(m.export_kind ?? m.exportKind ?? "").trim();
      const hint = String(m.filename ?? m.label ?? "").trim();
      const extra = [kind && `loại «${kind}»`, hint && `tệp ${hint}`].filter(Boolean).join(", ");
      return extra ? `Xuất dữ liệu (${extra}).` : "Xuất dữ liệu (Excel / tệp).";
    }
    default:
      return `Thao tác ${mongoAction} (${entityType}).`;
  }
}

export type ElecCrmAuditEmitParams = {
  actorUserId: Types.ObjectId | string;
  action: AuditAction;
  entityType: string;
  entityId: Types.ObjectId | string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  actorEmail?: string | null;
  actorDisplayName?: string | null;
};

/**
 * Gửi bản sao audit lên hạ tầng CRM (Log Bridge). Không throw — không chặn luồng nghiệp vụ.
 */
export function emitElecCrmAudit(params: ElecCrmAuditEmitParams): void {
  try {
    const logger = getSharedLogger();
    if (!logger) return;

    const actorStr = String(params.actorUserId);
    const entityIdStr = String(params.entityId);
    const meta: Record<string, unknown> = { ...(params.metadata ?? {}) };

    const paramEmail = params.actorEmail != null ? String(params.actorEmail).trim() : "";
    const paramName = params.actorDisplayName != null ? String(params.actorDisplayName).trim() : "";
    const metaEmail = typeof meta.actorEmail === "string" && meta.actorEmail.includes("@") ? meta.actorEmail.trim() : "";
    const metaName =
      typeof meta.actorDisplayName === "string" && meta.actorDisplayName.trim() ? meta.actorDisplayName.trim() : "";
    if (paramEmail.includes("@") && !metaEmail) {
      meta.actorEmail = paramEmail;
    }
    if (paramName && !metaName) {
      meta.actorDisplayName = paramName;
    }

    const resolvedEmail =
      (typeof meta.actorEmail === "string" && meta.actorEmail.includes("@") ? meta.actorEmail.trim() : "") || "";
    const isSystemActor = actorStr === ELEC_SYSTEM_AUDIT_ACTOR_ID;

    const auditAction = auditActionForCentral(params.action);
    const summary = buildViSummary(params.action, meta, params.entityType);
    const event = auditAction;

    logger.audit(summary, {
      userId: actorStr,
      userEmail: resolvedEmail || undefined,
      ip: params.ip ?? undefined,
      userAgent: params.userAgent ?? undefined,
      event,
      audit: {
        action: auditAction,
        module: "elec",
        resourceType: params.entityType,
        resourceId: entityIdStr,
        outcome: "success",
        summary,
        details: meta,
        actorType: isSystemActor ? "system" : "user",
      },
      metadata: { ...meta, mongoAuditAction: params.action, entityType: params.entityType },
    });
  } catch {
    /* ignore */
  }
}
