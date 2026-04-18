import type { NextFunction, Request, Response } from "express";

function headerString(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()] ?? req.headers[name];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0].trim();
  return undefined;
}

/**
 * Đọc identity do Gateway gắn khi proxy CRM → elec-service (strip spoof từ client).
 */
export function attachFujiIdentityFromHeaders(req: Request, _res: Response, next: NextFunction): void {
  const uid = headerString(req, "x-fuji-user-id");
  if (uid) req.fujiUserId = uid;

  const rolesRaw = headerString(req, "x-fuji-user-roles");
  if (rolesRaw) {
    req.fujiUserRoles = rolesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const authType = headerString(req, "x-fuji-auth-type");
  if (authType) req.fujiAuthType = authType;

  next();
}
