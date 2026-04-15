import { Request, Response } from "express";
import { CustomerAccountService } from "./customer-accounts.service";

export const CustomerAccountController = {
  async list(req: Request, res: Response) {
    try {
      const search = String(req.query.search || "").trim();
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

      const { data, total } = await CustomerAccountService.getList(search, page, limit);
      res.json({ data, total, page, limit });
    } catch (err) {
      res.status(500).json({ error: "Lỗi server" });
    }
  },

  async import(req: Request, res: Response) {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows không hợp lệ hoặc rỗng" });
    }
    if (rows.length > 5000) {
      return res.status(400).json({ error: "Tối đa 5000 dòng mỗi lần import" });
    }

    try {
      const result = await CustomerAccountService.importRows(rows);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: "Lỗi server khi import" });
    }
  },

  async delete(req: Request, res: Response) {
    try {
      //ep kieu = string
      const id = String(req.params.id);
      const deleted = await CustomerAccountService.deleteAccount(id);
      if (!deleted) return res.status(404).json({ error: "Không tìm thấy" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Lỗi server" });
    }
  },

  async patch(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const doc = await CustomerAccountService.updateAccount(id, req.body);
      if (!doc) return res.status(404).json({ error: "Không tìm thấy" });
      res.json({ ok: true, data: doc });
    } catch (err) {
      res.status(500).json({ error: "Lỗi server" });
    }
  }
};