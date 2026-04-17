import { Request, Response } from "express";
import { BillingScanService } from "./billing-scan.service";

export const BillingScanController = {
  // Deprecated endpoints
  deprecatedJob(req: Request, res: Response) {
    res.status(410).json({
      error: "Billing scan job deprecated.",
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

  async approveScannedCodesBatch(req: Request, res: Response) {
    try {
      const body = req.body as { ids?: unknown } | undefined;
      const ids = Array.isArray(body?.ids) ? body?.ids : [];
      const result = await BillingScanService.approveScannedCodesBatch(ids);
      res.status(result.status).json(result.payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Duyệt hàng loạt thất bại";
      res.status(500).json({ error: message });
    }
  },

  async revokeElectricBillScanApproval(req: Request, res: Response) {
    try {
      const billId = String(req.params.billId ?? "");
      const body = req.body as { actorRoles?: unknown } | undefined;
      const result = await BillingScanService.revokeElectricBillScanApproval(billId, body?.actorRoles);
      res.status(result.status).json(result.payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Huy duyet that bai";
      res.status(500).json({ error: message });
    }
  },
};
