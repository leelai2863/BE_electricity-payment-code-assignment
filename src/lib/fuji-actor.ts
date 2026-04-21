import type { Request } from "express";

/** Nhãn actor từ Gateway (introspect IAM) — dùng khi ghi audit lên CRM / Log Bridge. */
export type FujiAuditActorLabels = {
  actorEmail?: string;
  actorDisplayName?: string;
};

export function fujiAuditActorLabelsFromRequest(req: Request): FujiAuditActorLabels {
  const em = typeof req.fujiUserEmail === "string" && req.fujiUserEmail.includes("@") ? req.fujiUserEmail.trim() : "";
  const dn =
    typeof req.fujiUserDisplayName === "string" && req.fujiUserDisplayName.trim()
      ? req.fujiUserDisplayName.trim()
      : "";
  return {
    ...(em ? { actorEmail: em } : {}),
    ...(dn ? { actorDisplayName: dn } : {}),
  };
}

/**
 * Ưu tiên `actorUserId` trong body; nếu thiếu thì lấy từ header Gateway (`x-fuji-user-id`).
 */
export function mergeBodyWithFujiActor<T extends Record<string, unknown>>(req: Request, body: T): T & { actorUserId?: string } {
  const fromHeader = typeof req.fujiUserId === "string" && req.fujiUserId.trim() ? req.fujiUserId.trim() : "";
  const raw = (body as { actorUserId?: unknown }).actorUserId;
  const fromBody = typeof raw === "string" && raw.trim() ? raw.trim() : "";
  return {
    ...body,
    actorUserId: fromBody || fromHeader || undefined,
  };
}

function hasRole(req: Request, role: string): boolean {
  const r = role.trim().toUpperCase();
  return Array.isArray(req.fujiUserRoles) && req.fujiUserRoles.some((x) => String(x).trim().toUpperCase() === r);
}

/**
 * User CUSTOMER bắt buộc có agencyId scope hợp lệ.
 * - Trả `null` nếu request không phải CUSTOMER.
 * - Trả string agencyId (ObjectId hex) cho CUSTOMER.
 * - Ném lỗi khi CUSTOMER thiếu scope.
 */
export function requiredAgencyScopeIdForCustomer(req: Request): string | null {
  if (!hasRole(req, "CUSTOMER")) return null;
  const agencyId = typeof req.fujiAgencyId === "string" ? req.fujiAgencyId.trim() : "";
  if (!/^[a-fA-F0-9]{24}$/.test(agencyId)) {
    throw new Error("Tài khoản đại lý chưa được gán phạm vi dữ liệu.");
  }
  return agencyId;
}
