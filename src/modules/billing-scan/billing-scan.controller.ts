import { Request, Response } from "express";
import { BillingScanService } from "./billing-scan.service";

export const BillingScanController = {
  // Các endpoint đã ngừng sử dụng
  deprecatedJob(req: Request, res: Response) {
    res.status(410).json({
      error: "Billing scan job đã ngừng sử dụng.",
      data: req.method === "GET" ? [] : undefined,
    });
  },

  async getHistory(req: Request, res: Response) {
    try {
      const data = await BillingScanService.getHistory();
      res.json({ data, source: "mongodb" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
      res.status(503).json({ error: message, data: [] });
    }
  },

  async getScannedCodes(req: Request, res: Response) {
    try {
      const data = await BillingScanService.getScannedCodes();
      res.json({ data, source: "mongodb" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Không đọc được MongoDB";
      res.status(503).json({ error: message, data: [] });
    }
  },

  async approveScannedCode(req: Request, res: Response) {
    try {
      const id = String(req.params.id ?? "");
      const result = await BillingScanService.approveScannedCode(id);
      res.status(result.status).json(result.payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Duyệt thất bại";
      res.status(500).json({ error: message });
    }
  },
};