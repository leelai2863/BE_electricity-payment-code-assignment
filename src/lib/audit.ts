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
  });
}
