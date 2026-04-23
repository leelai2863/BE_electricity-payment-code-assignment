import type { Request, Response } from "express";
import mongoose from "mongoose";
import { writeAuditLog } from "@/lib/audit";
import { ELEC_SYSTEM_AUDIT_ACTOR_ID } from "@/lib/elec-crm-audit";
import { purgeMockData } from "./dev-tools.service";

function readSecret(headers: Request["headers"]): string | null {
  const x = headers["x-mockdata-secret"];
  if (typeof x === "string" && x.trim()) return x.trim();
  const auth = headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return null;
}

export const DevToolsController = {
  async purgeMockData(req: Request, res: Response) {
    const expected = (process.env.MOCKDATA_PURGE_SECRET ?? "").trim();
    if (!expected) {
      res.status(503).json({
        ok: false,
        error: "mockdata_purge_not_configured",
        message: "Set MOCKDATA_PURGE_SECRET in backend .env",
      });
      return;
    }

    const got = readSecret(req.headers);
    if (!got || got !== expected) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    try {
      const summary = await purgeMockData();
      const actorRaw = typeof req.fujiUserId === "string" ? req.fujiUserId.trim() : "";
      const actorUserId =
        actorRaw && mongoose.isValidObjectId(actorRaw)
          ? new mongoose.Types.ObjectId(actorRaw)
          : new mongoose.Types.ObjectId(ELEC_SYSTEM_AUDIT_ACTOR_ID);
      await writeAuditLog({
        actorUserId,
        action: "dev_tools.purge_mock_data",
        entityType: "SystemMaintenance",
        entityId: new mongoose.Types.ObjectId(),
        metadata: {
          summary,
          collectionsAffected: Object.keys(summary).length,
        },
        ip: req.ip ?? null,
        userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      });
      res.json({ ok: true, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : "purge_failed";
      res.status(500).json({ ok: false, error: "purge_failed", message });
    }
  },
};

