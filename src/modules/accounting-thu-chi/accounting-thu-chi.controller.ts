import type { Request, Response } from "express";
import { fujiAuditActorLabelsFromRequest, mergeBodyWithFujiActor } from "@/lib/fuji-actor";
import { ServiceError } from "@/modules/electric-bills/electric-bills.helpers";
import {
  createThuChi,
  createThuChiBankCatalog,
  deleteThuChiBankCatalog,
  getThuChiById,
  listThuChi,
  listThuChiBankCatalog,
  removeThuChi,
  updateThuChi,
  updateThuChiBankCatalog,
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
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await createThuChi(body, {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không lưu được");
  }
}

export async function updateThuChiHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await updateThuChi(String(req.params.id), body, {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không cập nhật được");
  }
}

export async function removeThuChiHandler(req: Request, res: Response) {
  try {
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await removeThuChi(String(req.params.id), {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không xóa được");
  }
}

export async function listThuChiBankCatalogHandler(req: Request, res: Response) {
  try {
    const result = await listThuChiBankCatalog(req.query as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được danh mục ngân hàng");
  }
}

export async function createThuChiBankCatalogHandler(req: Request, res: Response) {
  try {
    const result = await createThuChiBankCatalog((req.body ?? {}) as Record<string, unknown>);
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không tạo được ngân hàng");
  }
}

export async function updateThuChiBankCatalogHandler(req: Request, res: Response) {
  try {
    const result = await updateThuChiBankCatalog(String(req.params.id), (req.body ?? {}) as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không cập nhật được ngân hàng");
  }
}

export async function deleteThuChiBankCatalogHandler(req: Request, res: Response) {
  try {
    const result = await deleteThuChiBankCatalog(String(req.params.id));
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không xóa được ngân hàng");
  }
}
