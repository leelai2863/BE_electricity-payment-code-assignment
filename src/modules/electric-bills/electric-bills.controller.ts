import type { Request, Response } from "express";
import {
  fujiAuditActorLabelsFromRequest,
  mergeBodyWithFujiActor,
  requiredAgencyScopeIdForCustomer,
} from "@/lib/fuji-actor";
import type { PatchBody } from "@/modules/electric-bills/electric-bills.helpers";
import {
  enqueueUnassignedPaymentDeadlineSync,
  parseTargetedPaymentDeadline,
} from "@/modules/electric-bills/payment-deadline-sync.service";
import {
  ServiceError,
  listUnassignedBills,
  getInvoiceList,
  getInvoiceCompletedMonths,
  getInvoiceCompleted,
  getMailQueue,
  listRefundFeeRules,
  createRefundFeeRule,
  updateRefundFeeRule,
  removeRefundFeeRule,
  patchRefundLineStates,
  migrateRefundLocalStorage,
  getAssignedCodes,
  assignAgency,
  patchElectricBill,
  createManualElectricBill,
  recordDataExportAudit,
} from "./electric-bills.service";

function handleError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof ServiceError) {
    res.status(error.status).json({
      error: error.message,
      ...(error.payload ?? {}),
    });
    return;
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  res.status(500).json({ error: message });
}

export async function postDataExportAuditHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const exportKind = typeof body.exportKind === "string" ? body.exportKind.trim() : "";
    if (!exportKind) {
      res.status(400).json({ error: "exportKind là bắt buộc" });
      return;
    }
    if (!body.actorUserId) {
      res.status(401).json({ error: "Thiếu định danh người dùng" });
      return;
    }
    const meta =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {};
    const labels = fujiAuditActorLabelsFromRequest(req);
    await recordDataExportAudit({
      actorUserId: String(body.actorUserId),
      exportKind,
      metadata: meta,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "Không ghi nhận audit xuất dữ liệu");
  }
}

export async function getUnassignedHandler(req: Request, res: Response) {
  try {
    const result = await listUnassignedBills(req.query);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function postUnassignedPaymentDeadlineSyncHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const billIds = Array.isArray(body.billIds) ? (body.billIds as unknown[]).filter((x) => typeof x === "string") : undefined;
    const rawTargeted = body.targeted;
    if (rawTargeted != null && typeof rawTargeted === "object") {
      const targeted = parseTargetedPaymentDeadline(rawTargeted);
      if (!targeted) {
        throw new ServiceError(
          400,
          "targeted không hợp lệ: cần billId, ky (1–3), billingThang (1–12), billingNam (2000–2100).",
        );
      }
      const result = await enqueueUnassignedPaymentDeadlineSync({
        billIds: billIds as string[] | undefined,
        force: Boolean(body.force),
        requestedBy: body.requestedBy === "user" ? "user" : "system",
        targeted,
      });
      res.json({ ...result, source: "payment_deadline_sync_queue" });
      return;
    }
    const result = await enqueueUnassignedPaymentDeadlineSync({
      billIds: billIds as string[] | undefined,
      force: Boolean(body.force),
      requestedBy: body.requestedBy === "user" ? "user" : "system",
    });
    res.json({ ...result, source: "payment_deadline_sync_queue" });
  } catch (error) {
    handleError(res, error, "Không xếp hàng đồng bộ được");
  }
}

export async function getInvoiceListHandler(req: Request, res: Response) {
  try {
    let agencyScopeId: string | null;
    try {
      agencyScopeId = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (agencyScopeId && typeof req.query.assignedAgencyName === "string" && req.query.assignedAgencyName.trim()) {
      res.status(403).json({ error: "Không được lọc theo đại lý ngoài phạm vi được cấp." });
      return;
    }
    const result = await getInvoiceList(req.query, { agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getInvoiceCompletedMonthsHandler(_req: Request, res: Response) {
  try {
    let agencyScopeId: string | null;
    try {
      agencyScopeId = requiredAgencyScopeIdForCustomer(_req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    const result = await getInvoiceCompletedMonths({ agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getInvoiceCompletedHandler(req: Request, res: Response) {
  try {
    let agencyScopeId: string | null;
    try {
      agencyScopeId = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    const result = await getInvoiceCompleted(req.query, { agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getMailQueueHandler(_req: Request, res: Response) {
  try {
    let agencyScopeId: string | null;
    try {
      agencyScopeId = requiredAgencyScopeIdForCustomer(_req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    const result = await getMailQueue({ agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function createRefundFeeRuleHandler(req: Request, res: Response) {
  try {
    const result = await createRefundFeeRule(req.body);
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không lưu được");
  }
}

export async function listRefundFeeRulesHandler(req: Request, res: Response) {
  try {
    const result = await listRefundFeeRules(req.query);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được");
  }
}

export async function updateRefundFeeRuleHandler(req: Request, res: Response) {
  try {
    const result = await updateRefundFeeRule(String(req.params.id), req.body);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không cập nhật được");
  }
}

export async function removeRefundFeeRuleHandler(req: Request, res: Response) {
  try {
    const result = await removeRefundFeeRule(String(req.params.id));
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không xóa được");
  }
}

export async function patchRefundLineStatesHandler(req: Request, res: Response) {
  try {
    let agencyScopeId: string | null = null;
    try {
      agencyScopeId = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (agencyScopeId) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa trạng thái hoàn tiền." });
      return;
    }
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await patchRefundLineStates(body as Parameters<typeof patchRefundLineStates>[0], {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Cập nhật không thành công");
  }
}

export async function migrateRefundLocalStorageHandler(req: Request, res: Response) {
  try {
    const result = await migrateRefundLocalStorage(req.body);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Migrate không thành công");
  }
}

export async function getAssignedCodesHandler(req: Request, res: Response) {
  try {
    const result = await getAssignedCodes(req.query);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function assignAgencyHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await assignAgency(
      body as { billId: string; agencyId: string; agencyName: string; actorUserId?: string },
      fujiAuditActorLabelsFromRequest(req)
    );
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không giao được mã");
  }
}

export async function patchElectricBillHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await patchElectricBill(
      String(req.params.id),
      body as PatchBody,
      fujiAuditActorLabelsFromRequest(req)
    );
    res.json(result);
  } catch (error) {
    handleError(res, error, "Cập nhật không thành công");
  }
}

export async function createManualElectricBillHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await createManualElectricBill(body, fujiAuditActorLabelsFromRequest(req));
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không tạo được hóa đơn");
  }
}