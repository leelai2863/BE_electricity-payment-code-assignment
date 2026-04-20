import type { Request, Response } from "express";
import { mergeBodyWithFujiActor } from "@/lib/fuji-actor";
import { ServiceError } from "@/modules/electric-bills/electric-bills.helpers";
import {
  createBankCatalogEntry,
  createThuChi,
  getThuChiById,
  listBankCatalogEntries,
  listThuChi,
  removeBankCatalogEntry,
  removeThuChi,
  updateBankCatalogEntry,
  updateThuChi,
} from "./accounting-thu-chi.service";

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

export async function listThuChiHandler(req: Request, res: Response) {
  try {
    const result = await listThuChi(req.query as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được");
  }
}

export async function getThuChiByIdHandler(req: Request, res: Response) {
  try {
    const result = await getThuChiById(String(req.params.id));
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được");
  }
}

export async function createThuChiHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await createThuChi(body, {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
    });
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không lưu được");
  }
}

export async function updateThuChiHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await updateThuChi(String(req.params.id), body, {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không cập nhật được");
  }
}

export async function removeThuChiHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await removeThuChi(String(req.params.id), {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không xóa được");
  }
}

export async function listBankCatalogHandler(req: Request, res: Response) {
  try {
    const result = await listBankCatalogEntries(req.query as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được danh mục ngân hàng");
  }
}

export async function createBankCatalogEntryHandler(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await createBankCatalogEntry(body);
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không lưu được danh mục ngân hàng");
  }
}

export async function updateBankCatalogEntryHandler(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await updateBankCatalogEntry(String(req.params.id), body);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không cập nhật được danh mục ngân hàng");
  }
}

export async function removeBankCatalogEntryHandler(req: Request, res: Response) {
  try {
    const result = await removeBankCatalogEntry(String(req.params.id));
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không xóa được ngân hàng");
  }
}
