import type { Request, Response } from "express";
import { fujiAuditActorLabelsFromRequest, mergeBodyWithFujiActor, requiredAgencyScopeIdForCustomer } from "@/lib/fuji-actor";
import { ServiceError } from "@/modules/electric-bills/electric-bills.helpers";
import {
  createThuChi,
  createThuChiBankCatalog,
  createThuChiSourceCatalog,
  deleteThuChiBankCatalog,
  deleteThuChiSourceCatalog,
  getThuChiById,
  listThuChi,
  listThuChiBankCatalog,
  listThuChiSourceCatalog,
  previewHaCuocFromQuery,
  removeThuChi,
  updateThuChi,
  updateThuChiBankCatalog,
  updateThuChiSourceCatalog,
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

export async function previewHaCuocHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được xem preview Hạ Cước." });
      return;
    }
    const result = await previewHaCuocFromQuery(req.query as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Preview Hạ Cước thất bại");
  }
}

export async function listThuChiHandler(req: Request, res: Response) {
  try {
    let agencyScopeId: string | null;
    try {
      agencyScopeId = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (agencyScopeId && typeof req.query.agencyCode === "string" && req.query.agencyCode.trim()) {
      res.status(403).json({ error: "Không được lọc theo đại lý ngoài phạm vi được cấp." });
      return;
    }
    if (agencyScopeId) {
      res.status(403).json({ error: "Tài khoản đại lý không được xem bảng thu chi." });
      return;
    }
    const result = await listThuChi(req.query as Record<string, unknown>, { agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được");
  }
}

export async function getThuChiByIdHandler(req: Request, res: Response) {
  try {
    let agencyScopeId: string | null;
    try {
      agencyScopeId = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (agencyScopeId) {
      res.status(403).json({ error: "Tài khoản đại lý không được xem bảng thu chi." });
      return;
    }
    const result = await getThuChiById(String(req.params.id), { agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được");
  }
}

export async function createThuChiHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa bảng thu chi." });
      return;
    }
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
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa bảng thu chi." });
      return;
    }
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
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa bảng thu chi." });
      return;
    }
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
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được xem danh mục ngân hàng thu chi." });
      return;
    }
    const result = await listThuChiBankCatalog(req.query as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được danh mục ngân hàng");
  }
}

export async function createThuChiBankCatalogHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục ngân hàng." });
      return;
    }
    const result = await createThuChiBankCatalog((req.body ?? {}) as Record<string, unknown>);
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không tạo được ngân hàng");
  }
}

export async function updateThuChiBankCatalogHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục ngân hàng." });
      return;
    }
    const result = await updateThuChiBankCatalog(String(req.params.id), (req.body ?? {}) as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không cập nhật được ngân hàng");
  }
}

export async function deleteThuChiBankCatalogHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục ngân hàng." });
      return;
    }
    const result = await deleteThuChiBankCatalog(String(req.params.id));
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không xóa được ngân hàng");
  }
}

export async function listThuChiSourceCatalogHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được xem danh mục nguồn ngoài thu chi." });
      return;
    }
    const result = await listThuChiSourceCatalog(req.query as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được danh mục nguồn ngoài");
  }
}

export async function createThuChiSourceCatalogHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục nguồn ngoài." });
      return;
    }
    const result = await createThuChiSourceCatalog((req.body ?? {}) as Record<string, unknown>);
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không tạo được nguồn ngoài");
  }
}

export async function updateThuChiSourceCatalogHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục nguồn ngoài." });
      return;
    }
    const result = await updateThuChiSourceCatalog(String(req.params.id), (req.body ?? {}) as Record<string, unknown>);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không cập nhật được nguồn ngoài");
  }
}

export async function deleteThuChiSourceCatalogHandler(req: Request, res: Response) {
  try {
    let customerScope: string | null = null;
    try {
      customerScope = requiredAgencyScopeIdForCustomer(req);
    } catch {
      res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
      return;
    }
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục nguồn ngoài." });
      return;
    }
    const result = await deleteThuChiSourceCatalog(String(req.params.id));
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không xóa được nguồn ngoài");
  }
}
