import type { Request, Response } from "express";
import { mergeBodyWithFujiActor } from "@/lib/fuji-actor";
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
    const result = await getInvoiceList(req.query);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getInvoiceCompletedMonthsHandler(_req: Request, res: Response) {
  try {
    const result = await getInvoiceCompletedMonths();
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getInvoiceCompletedHandler(req: Request, res: Response) {
  try {
    const result = await getInvoiceCompleted(req.query);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getMailQueueHandler(_req: Request, res: Response) {
  try {
    const result = await getMailQueue();
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
    const result = await patchRefundLineStates(req.body);
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
      body as { billId: string; agencyId: string; agencyName: string; actorUserId?: string }
    );
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không giao được mã");
  }
}

export async function patchElectricBillHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await patchElectricBill(String(req.params.id), body as PatchBody);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Cập nhật không thành công");
  }
}

export async function createManualElectricBillHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await createManualElectricBill(body);
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không tạo được hóa đơn");
  }
}