//dieu huong HTTP request lien quan den agency o day

import { Request, Response } from "express";
import { AgenciesService } from "./agencies.service";
import { isMongoDuplicateKeyError } from "@/lib/agency-repository";

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
      const data = await AgenciesService.createNewAgency({ 
        name: String(name), 
        code: code ? String(code) : undefined 
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
      const data = await AgenciesService.updateName(id, name);
      res.json({ data });
    } catch (e: any) {
      const status = e.message === "Không tìm thấy đại lý" ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  },

  async delete(req: Request, res: Response) {
    const id = String(req.params.id ?? "");
    try {
      await AgenciesService.removeAgency(id);
      res.json({ ok: true });
    } catch (e: any) {
      const status = e.message === "Không tìm thấy đại lý" ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  }
};