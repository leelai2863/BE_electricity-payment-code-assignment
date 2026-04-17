import type { Request, Response } from "express";
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
    const result = await assignAgency(req.body);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không giao được mã");
  }
}

export async function patchElectricBillHandler(req: Request, res: Response) {
  try {
    const result = await patchElectricBill(String(req.params.id), req.body);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Cập nhật không thành công");
  }
}