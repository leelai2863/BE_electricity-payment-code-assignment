import type { Request, Response } from "express";
import { fujiAuditActorLabelsFromRequest, mergeBodyWithFujiActor } from "@/lib/fuji-actor";
import {
  getVouchers,
  ocrVoucher,
  updateVoucherProfile,
  approveVoucher,
  VouchersServiceError,
} from "./vouchers.service";

function handleError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof VouchersServiceError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  res.status(500).json({ error: message });
}

export async function getVouchersController(req: Request, res: Response) {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const result = await getVouchers(status);
    res.json(result);
  } catch (error) {
    handleError(res, error, "Failed to get vouchers");
  }
}

export async function ocrVoucherController(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>) as {
      cccdBase64?: string;
      billBase64?: string;
      actorUserId?: string;
    };

    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await ocrVoucher({
      id,
      cccdBase64: body.cccdBase64,
      billBase64: body.billBase64,
      actorUserId: body.actorUserId,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });

    res.json(result);
  } catch (error) {
    handleError(res, error, "OCR failed");
  }
}

export async function updateVoucherProfileController(req: Request, res: Response) {
  const id = String(req.params.id);
  const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>) as {
    customerProfile?: Record<string, unknown>;
    actorUserId?: string;
  };

  if (!body.customerProfile || typeof body.customerProfile !== "object") {
    res.status(400).json({ error: "customerProfile required" });
    return;
  }

  try {
    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await updateVoucherProfile({
      id,
      customerProfile: body.customerProfile,
      actorUserId: body.actorUserId,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });

    res.json(result);
  } catch (error) {
    handleError(res, error, "Update failed");
  }
}

export async function approveVoucherController(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const body = mergeBodyWithFujiActor(req, (req.body ?? {}) as Record<string, unknown>) as {
      actorUserId?: string;
    };

    const labels = fujiAuditActorLabelsFromRequest(req);
    const result = await approveVoucher({
      id,
      actorUserId: body.actorUserId,
      actorEmail: labels.actorEmail,
      actorDisplayName: labels.actorDisplayName,
    });

    res.json(result);
  } catch (error) {
    handleError(res, error, "Approve failed");
  }
}