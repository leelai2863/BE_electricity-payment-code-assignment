import type { Request, Response } from "express";
import mongoose from "mongoose";

function requestHasSuperAdminRole(req: Request): boolean {
  return (
    Array.isArray(req.fujiUserRoles) &&
    req.fujiUserRoles.some((x) => String(x).trim().toUpperCase() === "SUPER_ADMIN")
  );
}

function requestHasAdminOrSuperForSplitCancel(req: Request): boolean {
  return (
    Array.isArray(req.fujiUserRoles) &&
    req.fujiUserRoles.some((x) => {
      const r = String(x).trim().toUpperCase();
      return r === "SUPER_ADMIN" || r === "ADMIN";
    })
  );
}
import {
  fujiAuditActorLabelsFromRequest,
  mergeBodyWithFujiActor,
  requiredAgencyScopeIdForCustomer,
} from "@/lib/fuji-actor";
import { writeAuditLog } from "@/lib/audit";
import { ELEC_SYSTEM_AUDIT_ACTOR_ID } from "@/lib/elec-crm-audit";
import type { PatchBody } from "@/modules/electric-bills/electric-bills.helpers";
import {
  enqueueUnassignedPaymentDeadlineSync,
  parseTargetedPaymentDeadline,
} from "@/modules/electric-bills/payment-deadline-sync.service";
import { findSplitBillEntryById } from "@/modules/electric-bills/electric-bills.repository";
import {
  ServiceError,
  listUnassignedBills,
  getInvoiceList,
  getInvoiceCompletedMonths,
  getInvoiceCompleted,
  getMailQueue,
  getMailQueueWithQuery,
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
  getPendingBillList,
  markBillAsPending,
  markBillAsResolved,
  uploadPendingImage,
  patchSplitPeriod,
  cancelBillSplit,
} from "./electric-bills.service";
import path from "path";
import fs from "fs";

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

function customerAgencyScopeOr403(req: Request, res: Response): string | null | "__denied__" {
  try {
    return requiredAgencyScopeIdForCustomer(req);
  } catch {
    res.status(403).json({ error: "Tài khoản đại lý chưa được gán phạm vi dữ liệu." });
    return "__denied__";
  }
}

function resolveAuditActorId(raw?: unknown): mongoose.Types.ObjectId {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s && mongoose.isValidObjectId(s)) return new mongoose.Types.ObjectId(s);
  return new mongoose.Types.ObjectId(ELEC_SYSTEM_AUDIT_ACTOR_ID);
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
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chạy đồng bộ hàng chờ giao." });
      return;
    }
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
      const labels = fujiAuditActorLabelsFromRequest(req);
      await writeAuditLog({
        actorUserId: resolveAuditActorId(body.actorUserId),
        action: "electric.payment_deadline_sync_enqueue",
        entityType: "PaymentDeadlineSyncQueue",
        entityId: new mongoose.Types.ObjectId(),
        metadata: {
          targeted: true,
          billId: targeted.billId,
          ky: targeted.ky,
          billingThang: targeted.billingThang,
          billingNam: targeted.billingNam,
          enqueued: result.enqueued,
          duplicate: result.duplicate,
          skipped: result.skipped,
          cooldown: result.cooldown,
        },
        ip: req.ip ?? null,
        userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
        actorEmail: labels.actorEmail,
        actorDisplayName: labels.actorDisplayName,
      });
      res.json({ ...result, source: "payment_deadline_sync_queue" });
      return;
    }
    const result = await enqueueUnassignedPaymentDeadlineSync({
      billIds: billIds as string[] | undefined,
      force: Boolean(body.force),
      requestedBy: body.requestedBy === "user" ? "user" : "system",
    });
    const labels = fujiAuditActorLabelsFromRequest(req);
    await writeAuditLog({
      actorUserId: resolveAuditActorId(body.actorUserId),
      action: "electric.payment_deadline_sync_enqueue",
      entityType: "PaymentDeadlineSyncQueue",
      entityId: new mongoose.Types.ObjectId(),
      metadata: {
        targeted: false,
        force: Boolean(body.force),
        billIdsCount: Array.isArray(billIds) ? billIds.length : 0,
        enqueued: result.enqueued,
        duplicate: result.duplicate,
        skipped: result.skipped,
        cooldown: result.cooldown,
      },
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json({ ...result, source: "payment_deadline_sync_queue" });
  } catch (error) {
    handleError(res, error, "Không xếp hàng đồng bộ được");
  }
}

export async function getInvoiceListHandler(req: Request, res: Response) {
  try {
    const agencyScopeId = customerAgencyScopeOr403(req, res);
    if (agencyScopeId === "__denied__") return;
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
    const agencyScopeId = customerAgencyScopeOr403(_req, res);
    if (agencyScopeId === "__denied__") return;
    const result = await getInvoiceCompletedMonths({ agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getInvoiceCompletedHandler(req: Request, res: Response) {
  try {
    const agencyScopeId = customerAgencyScopeOr403(req, res);
    if (agencyScopeId === "__denied__") return;
    const result = await getInvoiceCompleted(req.query, { agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function getMailQueueHandler(_req: Request, res: Response) {
  try {
    const agencyScopeId = customerAgencyScopeOr403(_req, res);
    if (agencyScopeId === "__denied__") return;
    const hasQuery = Object.keys(_req.query ?? {}).length > 0;
    const result = hasQuery
      ? await getMailQueueWithQuery(_req.query as Record<string, unknown>, { agencyScopeId })
      : await getMailQueue({ agencyScopeId });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function createRefundFeeRuleHandler(req: Request, res: Response) {
  try {
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục phí." });
      return;
    }
    const body = (req.body ?? {}) as Parameters<typeof createRefundFeeRule>[0];
    const actorBody = mergeBodyWithFujiActor(req, {});
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await createRefundFeeRule(body, {
      actorUserId: actorBody.actorUserId as string | undefined,
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

export async function listRefundFeeRulesHandler(req: Request, res: Response) {
  try {
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được xem danh mục phí." });
      return;
    }
    const result = await listRefundFeeRules(req.query);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được");
  }
}

export async function updateRefundFeeRuleHandler(req: Request, res: Response) {
  try {
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục phí." });
      return;
    }
    const body = (req.body ?? {}) as Parameters<typeof updateRefundFeeRule>[1];
    const actorBody = mergeBodyWithFujiActor(req, {});
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await updateRefundFeeRule(String(req.params.id), body, {
      actorUserId: actorBody.actorUserId as string | undefined,
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

export async function removeRefundFeeRuleHandler(req: Request, res: Response) {
  try {
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được chỉnh sửa danh mục phí." });
      return;
    }
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await removeRefundFeeRule(String(req.params.id), {
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

export async function patchRefundLineStatesHandler(req: Request, res: Response) {
  try {
    const agencyScopeId = customerAgencyScopeOr403(req, res);
    if (agencyScopeId === "__denied__") return;
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
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được migrate dữ liệu cục bộ." });
      return;
    }
    const body = (req.body ?? {}) as Parameters<typeof migrateRefundLocalStorage>[0];
    const actorBody = mergeBodyWithFujiActor(req, {});
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await migrateRefundLocalStorage(body, {
      actorUserId: actorBody.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Migrate không thành công");
  }
}

export async function getAssignedCodesHandler(req: Request, res: Response) {
  try {
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được xem danh sách giao mã." });
      return;
    }
    const result = await getAssignedCodes(req.query);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đọc được MongoDB");
  }
}

export async function assignAgencyHandler(req: Request, res: Response) {
  try {
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý chỉ được xem danh sách hóa đơn." });
      return;
    }
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
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý chỉ được xem danh sách hóa đơn." });
      return;
    }
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
    const customerScope = customerAgencyScopeOr403(req, res);
    if (customerScope === "__denied__") return;
    if (customerScope) {
      res.status(403).json({ error: "Tài khoản đại lý không được thêm hóa đơn nhập tay." });
      return;
    }
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const result = await createManualElectricBill(body, fujiAuditActorLabelsFromRequest(req));
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Không tạo được hóa đơn");
  }
}

// ─── Mã treo (Pending bills) ─────────────────────────────────────────────────

export async function getPendingListHandler(req: Request, res: Response) {
  try {
    const result = await getPendingBillList();
    res.json(result);
  } catch (error) {
    handleError(res, error, "Lỗi tải danh sách mã treo");
  }
}

export async function setPendingHandler(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const note = typeof body.note === "string" ? body.note : undefined;
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await markBillAsPending(id, note, {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không đánh dấu được mã treo");
  }
}

export async function resolvePendingHandler(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await markBillAsResolved(id, {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Không giải treo được hóa đơn");
  }
}

export async function uploadPendingImageHandler(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const imageField = req.params.field === "cccd" ? "cccd" : "bill";

    // Expect multipart/form-data with `file` field (handled by multer in router)
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "Không có file upload" });
      return;
    }

    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>);
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await uploadPendingImage(id, imageField, file.path, {
      actorUserId: body.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Upload ảnh thất bại");
  }
}

// ─── Hạ cước (Split bills) ───────────────────────────────────────────────────

export async function createSplitHandler(req: Request, res: Response) {
  try {
    const actorBody = mergeBodyWithFujiActor(req, {});
    const labels = fujiAuditActorLabelsFromRequest(req);
    await writeAuditLog({
      actorUserId: resolveAuditActorId(actorBody.actorUserId),
      action: "electric.split_manual_disabled_attempt",
      entityType: "SplitBillEntry",
      entityId: new mongoose.Types.ObjectId(),
      metadata: {
        billId: String(req.params.id ?? "").trim() || null,
      },
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
  } catch {
    // audit không chặn phản hồi endpoint deprecated
  }
  res.status(410).json({
    error: "Tách mã thủ công đã tắt — chỉ thực hiện Hạ Cước qua trang Thu chi (nguồn «Hạ Cước»).",
    code: "SPLIT_MANUAL_DISABLED",
  });
}

export async function patchSplitHandler(req: Request, res: Response) {
  try {
    const splitId = String(req.params.splitId);
    const splitIdx = Number(req.params.splitIdx);
    if (splitIdx !== 1 && splitIdx !== 2) {
      res.status(400).json({ error: "splitIdx phải là 1 hoặc 2" });
      return;
    }
    const changes = (req.body ?? {}) as Record<string, unknown>;
    const actorBody = mergeBodyWithFujiActor(req, {});
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await patchSplitPeriod(splitId, splitIdx as 1 | 2, changes, {
      actorUserId: actorBody.actorUserId as string | undefined,
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Cập nhật split thất bại");
  }
}

export async function cancelSplitHandler(req: Request, res: Response) {
  try {
    const splitId = String(req.params.splitId);
    const ent = await findSplitBillEntryById(splitId);
    if (!ent) {
      res.status(404).json({ error: "Không tìm thấy split" });
      return;
    }
    const status = String((ent as { status?: unknown }).status ?? "");
    const locked =
      Boolean((ent as { lockedByThuChi?: boolean } | null)?.lockedByThuChi) ||
      String((ent as { createdBy?: string } | null)?.createdBy ?? "") === "thu-chi";
    const isSuperAdmin = requestHasSuperAdminRole(req);
    const canAdminCancel = requestHasAdminOrSuperForSplitCancel(req);
    if (locked && status === "resolved" && !isSuperAdmin) {
      res.status(403).json({
        error:
          "Split Thu chi đã hoàn tất chỉ SUPER_ADMIN mới được hủy từ Danh sách hóa đơn.",
        code: "SPLIT_THU_CHI_RESOLVED_SUPERADMIN_ONLY",
      });
      return;
    }
    if (locked && status !== "resolved" && !canAdminCancel) {
      res.status(403).json({
        error:
          "Split từ Thu chi: hủy từ Danh sách hóa đơn cần quyền ADMIN hoặc SUPER_ADMIN (mã về trạng thái trước hạ cước để Thu chi nhập lại). Các vai trò khác xóa/sửa dòng Thu chi tương ứng.",
        code: "SPLIT_THU_CHI_LOCKED",
      });
      return;
    }
    const result = await cancelBillSplit(splitId, {
      allowResolvedForSuperAdmin: locked && status === "resolved" && isSuperAdmin,
      actorUserId: req.fujiUserId ?? null,
      auditLabels: fujiAuditActorLabelsFromRequest(req),
      ip: req.ip ?? null,
      userAgent: typeof req.get === "function" ? req.get("user-agent") ?? null : null,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error, "Hủy tách mã thất bại");
  }
}

// ─── Static file helper for pending images ───────────────────────────────────

export function servePendingImageHandler(req: Request, res: Response) {
  const filename = req.params.filename;
  if (!filename || filename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filePath = path.join(process.cwd(), "uploads", "pending", String(filename));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.sendFile(filePath);
}