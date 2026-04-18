import mongoose from "mongoose";
import type { Request, Response } from "express";
import { writeAuditLog } from "@/lib/audit";
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
      if (result.status === 200 && req.fujiUserId && mongoose.isValidObjectId(req.fujiUserId)) {
        const p = result.payload as {
          ok?: boolean;
          data?: { customerCode?: string; skipped?: boolean; reason?: string };
        };
        if (p?.ok) {
          try {
            await writeAuditLog({
              actorUserId: req.fujiUserId,
              action: "billing_scan.approve_staging",
              entityType: "ChargesStagingRow",
              entityId: id,
              metadata: {
                customerCode: p.data?.customerCode,
                skippedDuplicate: Boolean(p.data?.skipped),
                reason: p.data?.reason,
              },
              ip: req.ip,
              userAgent: req.get("user-agent") ?? null,
            });
          } catch {
            /* audit không chặn response */
          }
        }
      }
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
      if (result.status === 200 && req.fujiUserId && mongoose.isValidObjectId(req.fujiUserId)) {
        const p = result.payload as {
          data?: { requested?: number; approved?: number; failed?: number; errors?: Array<{ id: string; error: string }> };
        };
        if (p?.data) {
          try {
            await writeAuditLog({
              actorUserId: req.fujiUserId,
              action: "billing_scan.approve_staging_batch",
              entityType: "BillingScanBatchApprove",
              entityId: new mongoose.Types.ObjectId(),
              metadata: {
                requested: p.data.requested,
                approved: p.data.approved,
                failed: p.data.failed,
                errorsPreview: Array.isArray(p.data.errors) ? p.data.errors.slice(0, 8) : [],
              },
              ip: req.ip,
              userAgent: req.get("user-agent") ?? null,
            });
          } catch {
            /* ignore */
          }
        }
      }
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
      if (result.status === 200 && req.fujiUserId && mongoose.isValidObjectId(req.fujiUserId)) {
        const p = result.payload as {
          ok?: boolean;
          data?: { billDeleted?: boolean; revivedStagingCount?: number; customerCode?: string };
        };
        if (p?.ok && p.data) {
          try {
            await writeAuditLog({
              actorUserId: req.fujiUserId,
              action: "billing_scan.revoke_scan_approval",
              entityType: "ElectricBillRecord",
              entityId: billId,
              metadata: {
                customerCode: p.data.customerCode,
                billDeleted: Boolean(p.data.billDeleted),
                revivedStagingCount: p.data.revivedStagingCount,
              },
              ip: req.ip,
              userAgent: req.get("user-agent") ?? null,
            });
          } catch {
            /* ignore */
          }
        }
      }
      res.status(result.status).json(result.payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Huy duyet that bai";
      res.status(500).json({ error: message });
    }
  },
};
