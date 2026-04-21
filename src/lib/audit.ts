import type { Types } from "mongoose";
import type { AuditAction } from "@/lib/audit-types";
import { emitElecCrmAudit } from "@/lib/elec-crm-audit";
import { AuditLog } from "@/models/AuditLog";

export type { AuditAction } from "@/lib/audit-types";

export async function writeAuditLog(params: {
  actorUserId: Types.ObjectId | string;
  action: AuditAction;
  entityType: string;
  entityId: Types.ObjectId | string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  /** Bổ sung khi metadata chưa có (vd. giao mã điện) — CRM hiển thị cột «Người thực hiện». */
  actorEmail?: string | null;
  actorDisplayName?: string | null;
}) {
  await AuditLog.create({
    actorUserId: params.actorUserId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: params.metadata ?? {},
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  });

  emitElecCrmAudit({
    actorUserId: params.actorUserId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: params.metadata,
    ip: params.ip,
    userAgent: params.userAgent,
    actorEmail: params.actorEmail,
    actorDisplayName: params.actorDisplayName,
  });
}
