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
