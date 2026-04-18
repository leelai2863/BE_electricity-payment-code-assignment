import type { Request } from "express";

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
