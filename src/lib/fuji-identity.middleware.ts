import type { NextFunction, Request, Response } from "express";
import { Buffer } from "node:buffer";

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

  const email = headerString(req, "x-fuji-user-email");
  if (email && email.includes("@")) {
    req.fujiUserEmail = email;
  }

  const nameB64 = headerString(req, "x-fuji-user-display-name-b64");
  if (nameB64) {
    try {
      const decoded = Buffer.from(nameB64, "base64url").toString("utf8").trim();
      if (decoded) req.fujiUserDisplayName = decoded;
    } catch {
      try {
        const decoded2 = Buffer.from(nameB64, "base64").toString("utf8").trim();
        if (decoded2) req.fujiUserDisplayName = decoded2;
      } catch {
        /* ignore */
      }
    }
  }

  const rolesRaw = headerString(req, "x-fuji-user-roles");
  if (rolesRaw) {
    req.fujiUserRoles = rolesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const authType = headerString(req, "x-fuji-auth-type");
  if (authType) req.fujiAuthType = authType;

  const agencyId = headerString(req, "x-fuji-agency-id");
  if (agencyId) req.fujiAgencyId = agencyId;

  next();
}
