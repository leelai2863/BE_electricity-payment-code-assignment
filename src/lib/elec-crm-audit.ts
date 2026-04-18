import type { Types } from "mongoose";
import { getSharedLogger } from "@core-x/shared-logger";
import type { AuditAction } from "@/lib/audit-types";

/** Actor cố định cho thao tác hệ thống (ingest checkbill — không có user IAM). */
export const ELEC_SYSTEM_AUDIT_ACTOR_ID = "000000000000000000000001";

function auditActionForCentral(mongoAction: AuditAction): string {
  const map: Partial<Record<AuditAction, string>> = {
    "electric.assign_agency": "elec.assign_agency",
    "electric.invoice_patch": "elec.invoice_patch",
    "electric.manual_create": "elec.manual_create",
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
    "auth.login": "elec.auth.login",
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
    case "electric.manual_create": {
      const code = String(m.customerCode ?? "").trim();
      const mo = m.month != null && m.year != null ? ` tháng ${m.month}/${m.year}` : "";
      return code ? `Thêm hóa đơn tay mã KH ${code}${mo}.` : `Thêm hóa đơn tay (${entityType}).`;
    }
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
    case "auth.login":
      return "Đăng nhập (elec).";
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
    const meta = { ...(params.metadata ?? {}) };
    const isSystemActor = actorStr === ELEC_SYSTEM_AUDIT_ACTOR_ID;

    const auditAction = auditActionForCentral(params.action);
    const summary = buildViSummary(params.action, meta, params.entityType);
    const event = auditAction;

    logger.audit(summary, {
      userId: actorStr,
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
