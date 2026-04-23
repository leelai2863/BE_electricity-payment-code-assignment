//dieu huong HTTP request lien quan den agency o day

import { Request, Response } from "express";
import { AgenciesService } from "./agencies.service";
import { isMongoDuplicateKeyError } from "@/lib/agency-repository";
import { fujiAuditActorLabelsFromRequest, mergeBodyWithFujiActor } from "@/lib/fuji-actor";

export const AgenciesController = {
  async list(req: Request, res: Response) {
    try {
      const data = await AgenciesService.getAllAgencies();
      res.json({ data });
    } catch (e) {
      console.error("GET /api/agencies error:", e);
      res.status(500).json({ error: "Lỗi đọc danh sách đại lý" });
    }
  },

  async tree(req: Request, res: Response) {
    try {
      const data = await AgenciesService.getAgencyTree();
      res.json({ data });
    } catch (e) {
      console.error("GET /api/agencies/tree error:", e);
      res.status(500).json({ error: "Lỗi đọc cây đại lý" });
    }
  },

  async create(req: Request, res: Response) {
    const { name = "", code } = req.body;
    try {
      const actorBody = mergeBodyWithFujiActor(req, {});
      const labels = fujiAuditActorLabelsFromRequest(req);
      const data = await AgenciesService.createNewAgency({ 
        name: String(name), 
        code: code ? String(code) : undefined 
      }, {
        actorUserId: actorBody.actorUserId as string | undefined,
        ip: req.ip ?? null,
        userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
        actorEmail: labels.actorEmail,
        actorDisplayName: labels.actorDisplayName,
      });
      res.json({ data });
    } catch (e) {
      if (e instanceof Error && (e.message.includes("Không tạo được") || e.message === "Tên đại lý không được để trống")) {
        return res.status(400).json({ error: e.message });
      }
      if (isMongoDuplicateKeyError(e)) {
        return res.status(400).json({ error: "Mã đại lý đã tồn tại" });
      }
      res.status(500).json({ error: "Lỗi lưu đại lý" });
    }
  },

  async update(req: Request, res: Response) {
    const id = String(req.params.id ?? "");
    const name = String(req.body.name ?? "");
    try {
      const actorBody = mergeBodyWithFujiActor(req, {});
      const labels = fujiAuditActorLabelsFromRequest(req);
      const data = await AgenciesService.updateName(id, name, {
        actorUserId: actorBody.actorUserId as string | undefined,
        ip: req.ip ?? null,
        userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
        actorEmail: labels.actorEmail,
        actorDisplayName: labels.actorDisplayName,
      });
      res.json({ data });
    } catch (e: any) {
      const status = e.message === "Không tìm thấy đại lý" ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  },

  async delete(req: Request, res: Response) {
    const id = String(req.params.id ?? "");
    try {
      const actorBody = mergeBodyWithFujiActor(req, {});
      const labels = fujiAuditActorLabelsFromRequest(req);
      await AgenciesService.removeAgency(id, {
        actorUserId: actorBody.actorUserId as string | undefined,
        ip: req.ip ?? null,
        userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
        actorEmail: labels.actorEmail,
        actorDisplayName: labels.actorDisplayName,
      });
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.message === "Không tìm thấy đại lý" ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  }
};