import mongoose from "mongoose";
import { Agency } from "@/models/Agency";
import { writeAuditLog } from "@/lib/audit";
import { ELEC_SYSTEM_AUDIT_ACTOR_ID } from "@/lib/elec-crm-audit";
import { ServiceError, ensureDb, getErrorMessage, toPositiveInt } from "@/modules/electric-bills/electric-bills.helpers";
import {
  createAccountingThuChiDoc,
  deleteAccountingThuChiDoc,
  findAccountingThuChiById,
  listAccountingThuChiEntries,
  type ThuChiListQueryFlow,
  type ThuChiListQueryLink,
  type ThuChiListSortMode,
  updateAccountingThuChiDoc,
} from "@/modules/accounting-thu-chi/accounting-thu-chi.repository";
import {
  deleteBankCatalogById,
  listBankCatalog,
  updateBankCatalogById,
  upsertBankCatalog,
} from "@/modules/accounting-thu-chi/user-bank-preference.repository";
import {
  deleteSourceCatalogById,
  getSourceCatalogEntryById,
  listSourceCatalog,
  updateSourceCatalogById,
  upsertHaCuocSystemSource,
  upsertSourceCatalog,
} from "@/modules/accounting-thu-chi/user-source-preference.repository";
import {
  applyHaCuocAfterThuChiSaved,
  formatAnchorDdMmHoChiMinh,
  isHaCuocSource,
  parseCustomerCodeFromDescription,
  previewHaCuoc,
  revertHaCuocContext,
  updateHaCuocSplitAmountsIfNeeded,
  vnCalendarYearMonth,
} from "@/modules/accounting-thu-chi/ha-cuoc.service";
import { patchSplitPeriod } from "@/modules/electric-bills/electric-bills.service";
import type { HaCuocContextLean } from "@/modules/accounting-thu-chi/accounting-thu-chi.repository";

/** Tạo mới: bỏ trống → null; giá trị không phải số hợp lệ → 400 */
function parseMoneyCreate(raw: unknown, fieldLabel: string): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ServiceError(400, `${fieldLabel} không hợp lệ`);
  }
  return Math.trunc(n);
}

/** Cập nhật: undefined = không đổi; null hoặc "" = xóa số về null */
function parseMoneyPatch(raw: unknown, fieldLabel: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ServiceError(400, `${fieldLabel} không hợp lệ`);
  }
  return Math.trunc(n);
}

function assertPositiveThuOrChi(effThu: number, effChi: number) {
  if (effThu <= 0 && effChi <= 0) {
    throw new ServiceError(400, "Cần có Thu hoặc Chi là số dương (không cho cả hai đều trống hoặc 0)");
  }
}

export type ThuChiAuditContext = {
  actorUserId?: string;
  ip?: string | null;
  userAgent?: string | null;
  actorEmail?: string | null;
  actorDisplayName?: string | null;
};

type ThuChiReadScope = {
  agencyScopeId?: string | null;
};

function resolveThuChiActorId(raw?: string | null): mongoose.Types.ObjectId {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s && mongoose.isValidObjectId(s)) return new mongoose.Types.ObjectId(s);
  return new mongoose.Types.ObjectId(ELEC_SYSTEM_AUDIT_ACTOR_ID);
}

function serializeHaCuocContext(ctx: HaCuocContextLean | null | undefined) {
  if (!ctx) return null;
  return {
    kind: ctx.kind,
    customerCode: ctx.customerCode,
    targetBillId: ctx.targetBillId,
    targetKy: ctx.targetKy,
    targetYear: ctx.targetYear,
    targetMonth: ctx.targetMonth,
    originalAmount: ctx.originalAmount,
    splitAmount1: ctx.splitAmount1,
    createdSplitEntryId: ctx.createdSplitEntryId ?? null,
    resolvedExistingSplit: Boolean(ctx.resolvedExistingSplit),
  };
}

async function resolveAgencyLinkForSource(sourceRaw: string): Promise<{
  linkedAgencyId: mongoose.Types.ObjectId | null;
  linkedAgencyCode: string | null;
  linkedAgencyName: string | null;
}> {
  const code = sourceRaw.trim().toUpperCase();
  if (!code) {
    return { linkedAgencyId: null, linkedAgencyCode: null, linkedAgencyName: null };
  }
  const agency = await Agency.findOne({ code, isActive: true }).lean();
  if (!agency?._id) {
    return { linkedAgencyId: null, linkedAgencyCode: null, linkedAgencyName: null };
  }
  return {
    linkedAgencyId: agency._id as mongoose.Types.ObjectId,
    linkedAgencyCode: String(agency.code ?? code).toUpperCase(),
    linkedAgencyName: typeof agency.name === "string" ? agency.name.trim() : null,
  };
}

function parseTxnDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseEffectivePaymentDate(raw: unknown, fallbackTxnDate: Date): Date | null {
  if (raw === undefined) return fallbackTxnDate;
  if (raw === null || String(raw).trim() === "") return null;
  const d = parseTxnDate(raw);
  if (!d) return null;
  return d;
}

export async function listThuChi(query: Record<string, unknown>, scope?: ThuChiReadScope) {
  await ensureDb();
  try {
    const page = toPositiveInt(query.page, 1);
    const pageSize = Math.min(500, toPositiveInt(query.pageSize, 100));
    const from =
      typeof query.from === "string" && query.from.trim() ? new Date(query.from) : undefined;
    const to = typeof query.to === "string" && query.to.trim() ? new Date(query.to) : undefined;
    if (from && Number.isNaN(from.getTime())) throw new ServiceError(400, "Tham số from không hợp lệ");
    if (to && Number.isNaN(to.getTime())) throw new ServiceError(400, "Tham số to không hợp lệ");
    const agencyCode = typeof query.agencyCode === "string" ? query.agencyCode.trim() : undefined;
    const textQ = typeof query.q === "string" ? query.q : undefined;
    const bankContains = typeof query.bank === "string" ? query.bank : undefined;
    const flowRaw = typeof query.flow === "string" ? query.flow.trim().toLowerCase() : "";
    const flow: ThuChiListQueryFlow = flowRaw === "thu" || flowRaw === "chi" ? flowRaw : "all";
    if (flowRaw && flowRaw !== "thu" && flowRaw !== "chi" && flowRaw !== "all") {
      throw new ServiceError(400, "Tham số flow phải là thu, chi hoặc all");
    }
    const linkRaw = typeof query.link === "string" ? query.link.trim().toLowerCase() : "";
    const link: ThuChiListQueryLink =
      linkRaw === "linked" || linkRaw === "unlinked" ? linkRaw : "all";
    if (linkRaw && linkRaw !== "linked" && linkRaw !== "unlinked" && linkRaw !== "all") {
      throw new ServiceError(400, "Tham số link phải là linked, unlinked hoặc all");
    }

    const sortRaw = typeof query.sort === "string" ? query.sort.trim().toLowerCase() : "";
    const sort: ThuChiListSortMode = sortRaw === "system" ? "system" : "recent";
    if (sortRaw && sortRaw !== "recent" && sortRaw !== "system") {
      throw new ServiceError(400, "Tham số sort phải là recent hoặc system");
    }

    const agencyScopeId = typeof scope?.agencyScopeId === "string" ? scope.agencyScopeId.trim() : "";
    if (agencyScopeId && !mongoose.isValidObjectId(agencyScopeId)) {
      throw new ServiceError(403, "Không có quyền truy cập dữ liệu đại lý.");
    }
    const { items, total } = await listAccountingThuChiEntries({
      from,
      to,
      agencyCode,
      linkedAgencyId: agencyScopeId || undefined,
      textQ: textQ?.trim() || undefined,
      bankContains: bankContains?.trim() || undefined,
      flow,
      link,
      sort,
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });

    const data = items.map((row, idx) => ({
      _id: String(row._id),
      stt: (page - 1) * pageSize + idx + 1,
      txnDate: row.txnDate.toISOString(),
      effectivePaymentDate: row.effectivePaymentDate ? row.effectivePaymentDate.toISOString() : null,
      description: row.description ?? "",
      source: row.source ?? "",
      bank: row.bank ?? "",
      thu: row.thu ?? null,
      chi: row.chi ?? null,
      notes: row.notes ?? "",
      linkedAgencyId: row.linkedAgencyId ? String(row.linkedAgencyId) : null,
      linkedAgencyCode: row.linkedAgencyCode ?? null,
      linkedAgencyName: row.linkedAgencyName ?? null,
      haCuocContext: serializeHaCuocContext(row.haCuocContext),
      createdAt: row.createdAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }));

    return { data, total, page, pageSize, source: "mongodb" as const };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"));
  }
}

export async function getThuChiById(id: string, scope?: ThuChiReadScope) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const row = await findAccountingThuChiById(id);
  if (!row) throw new ServiceError(404, "Không tìm thấy bản ghi");
  const agencyScopeId = typeof scope?.agencyScopeId === "string" ? scope.agencyScopeId.trim() : "";
  if (agencyScopeId) {
    const linkedAgencyId = row.linkedAgencyId ? String(row.linkedAgencyId) : "";
    if (!linkedAgencyId || linkedAgencyId !== agencyScopeId) {
      throw new ServiceError(403, "Không có quyền truy cập dữ liệu đại lý.");
    }
  }
  return {
    data: {
      _id: String(row._id),
      txnDate: row.txnDate.toISOString(),
      effectivePaymentDate: row.effectivePaymentDate ? row.effectivePaymentDate.toISOString() : null,
      description: row.description ?? "",
      source: row.source ?? "",
      bank: row.bank ?? "",
      thu: row.thu ?? null,
      chi: row.chi ?? null,
      notes: row.notes ?? "",
      linkedAgencyId: row.linkedAgencyId ? String(row.linkedAgencyId) : null,
      linkedAgencyCode: row.linkedAgencyCode ?? null,
      linkedAgencyName: row.linkedAgencyName ?? null,
      haCuocContext: serializeHaCuocContext(row.haCuocContext),
      createdAt: row.createdAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    },
    source: "mongodb" as const,
  };
}

export async function createThuChi(body: Record<string, unknown>, ctx?: ThuChiAuditContext) {
  await ensureDb();
  const txnDate = parseTxnDate(body.txnDate);
  if (!txnDate) throw new ServiceError(400, "txnDate không hợp lệ");
  const effectivePaymentDate = parseEffectivePaymentDate(body.effectivePaymentDate, txnDate);
  if (body.effectivePaymentDate !== undefined && body.effectivePaymentDate !== null && !effectivePaymentDate) {
    throw new ServiceError(400, "effectivePaymentDate không hợp lệ");
  }

  const description = typeof body.description === "string" ? body.description : "";
  const source = typeof body.source === "string" ? body.source : "";
  const bank = typeof body.bank === "string" ? body.bank : "";
  const notes = typeof body.notes === "string" ? body.notes : "";
  const thu = parseMoneyCreate(body.thu, "Thu");
  const chi = parseMoneyCreate(body.chi, "Chi");
  assertPositiveThuOrChi(thu ?? 0, chi ?? 0);

  const sourceTrim = source.trim();
  let link = await resolveAgencyLinkForSource(sourceTrim);
  if (isHaCuocSource(sourceTrim)) {
    link = { linkedAgencyId: null, linkedAgencyCode: null, linkedAgencyName: null };
    await upsertHaCuocSystemSource();
  } else if (!link.linkedAgencyId && sourceTrim) {
    await upsertSourceCatalog(sourceTrim);
  }

  try {
    let row: Record<string, unknown>;
    if (isHaCuocSource(sourceTrim)) {
      const preId = new mongoose.Types.ObjectId();
      const anchor = effectivePaymentDate ?? txnDate;
      let haCtx: HaCuocContextLean;
      try {
        haCtx = (await applyHaCuocAfterThuChiSaved({
          entryId: String(preId),
          source: sourceTrim,
          description: description.trim(),
          chi,
          thu,
          anchorDate: anchor,
        })) as HaCuocContextLean;
      } catch (applyErr) {
        throw applyErr;
      }
      try {
        await createAccountingThuChiDoc({
          _id: preId,
          txnDate,
          effectivePaymentDate,
          description: description.trim(),
          source: sourceTrim,
          bank: bank.trim(),
          thu,
          chi,
          notes: notes.trim(),
          linkedAgencyId: link.linkedAgencyId,
          linkedAgencyCode: link.linkedAgencyCode,
          linkedAgencyName: link.linkedAgencyName,
          haCuocContext: haCtx,
        });
      } catch (saveErr) {
        try {
          await revertHaCuocContext(haCtx, String(preId));
        } catch {
          /* ignore */
        }
        throw saveErr;
      }
      const reloaded = await findAccountingThuChiById(String(preId));
      row = (reloaded ?? {}) as Record<string, unknown>;
    } else {
      const doc = await createAccountingThuChiDoc({
        txnDate,
        effectivePaymentDate,
        description: description.trim(),
        source: sourceTrim,
        bank: bank.trim(),
        thu,
        chi,
        notes: notes.trim(),
        linkedAgencyId: link.linkedAgencyId,
        linkedAgencyCode: link.linkedAgencyCode,
        linkedAgencyName: link.linkedAgencyName,
      });
      row = (doc as { toObject?: () => Record<string, unknown> }).toObject?.() ?? (doc as unknown as Record<string, unknown>);
    }
    const oid = row._id as mongoose.Types.ObjectId;
    await writeAuditLog({
      actorUserId: resolveThuChiActorId(ctx?.actorUserId),
      action: "accounting.thu_chi_create",
      entityType: "AccountingThuChiEntry",
      entityId: oid,
      metadata: {
        entryId: String(oid),
        source: source.trim(),
        bank: bank.trim(),
        thuVnd: thu,
        chiVnd: chi,
        linkedAgencyCode: link.linkedAgencyCode,
        linkedAgencyName: link.linkedAgencyName,
        txnDate: txnDate.toISOString(),
        effectivePaymentDate: effectivePaymentDate ? effectivePaymentDate.toISOString() : null,
        changeSummary: `Tạo dòng thu chi; nội dung tóm tắt: ${description.trim().slice(0, 200)}`,
      },
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      actorEmail: ctx?.actorEmail,
      actorDisplayName: ctx?.actorDisplayName,
    });
    return { data: serializeDoc(row), source: "mongodb" as const };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(500, getErrorMessage(error, "Không lưu được"));
  }
}

function serializeDoc(row: Record<string, unknown>) {
  return {
    _id: String(row._id),
    txnDate: (row.txnDate as Date).toISOString(),
    effectivePaymentDate: row.effectivePaymentDate instanceof Date ? row.effectivePaymentDate.toISOString() : null,
    description: String(row.description ?? ""),
    source: String(row.source ?? ""),
    bank: String(row.bank ?? ""),
    thu: row.thu == null ? null : Number(row.thu),
    chi: row.chi == null ? null : Number(row.chi),
    notes: String(row.notes ?? ""),
    linkedAgencyId: row.linkedAgencyId ? String(row.linkedAgencyId) : null,
    linkedAgencyCode: row.linkedAgencyCode ? String(row.linkedAgencyCode) : null,
    linkedAgencyName: row.linkedAgencyName ? String(row.linkedAgencyName) : null,
    haCuocContext: serializeHaCuocContext(row.haCuocContext as HaCuocContextLean | null | undefined),
  };
}

export async function updateThuChi(id: string, body: Record<string, unknown>, ctx?: ThuChiAuditContext) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");

  const existing = await findAccountingThuChiById(id);
  if (!existing) throw new ServiceError(404, "Không tìm thấy bản ghi");

  const patch: Record<string, unknown> = {};
  if (body.txnDate !== undefined) {
    const d = parseTxnDate(body.txnDate);
    if (!d) throw new ServiceError(400, "txnDate không hợp lệ");
    patch.txnDate = d;
  }
  if (body.effectivePaymentDate !== undefined) {
    const fallbackTxn = (patch.txnDate as Date | undefined) ?? existing.txnDate;
    const d = parseEffectivePaymentDate(body.effectivePaymentDate, fallbackTxn);
    if (body.effectivePaymentDate !== null && !d) {
      throw new ServiceError(400, "effectivePaymentDate không hợp lệ");
    }
    patch.effectivePaymentDate = d;
  }
  if (body.description !== undefined) patch.description = String(body.description ?? "").trim();
  if (body.bank !== undefined) patch.bank = String(body.bank ?? "").trim();
  if (body.notes !== undefined) patch.notes = String(body.notes ?? "").trim();
  if (body.thu !== undefined) patch.thu = parseMoneyPatch(body.thu, "Thu");
  if (body.chi !== undefined) patch.chi = parseMoneyPatch(body.chi, "Chi");
  if (body.source !== undefined) patch.source = String(body.source ?? "").trim();

  const mergedThu = patch.thu !== undefined ? patch.thu : existing.thu;
  const mergedChi = patch.chi !== undefined ? patch.chi : existing.chi;
  if (body.thu !== undefined || body.chi !== undefined) {
    const effThu = typeof mergedThu === "number" ? mergedThu : 0;
    const effChi = typeof mergedChi === "number" ? mergedChi : 0;
    assertPositiveThuOrChi(effThu, effChi);
  }

  const sourceForLink =
    typeof patch.source === "string" ? patch.source : String(existing.source ?? "").trim();
  let link = await resolveAgencyLinkForSource(sourceForLink);
  if (isHaCuocSource(sourceForLink)) {
    link = { linkedAgencyId: null, linkedAgencyCode: null, linkedAgencyName: null };
    await upsertHaCuocSystemSource();
  } else if (!link.linkedAgencyId && sourceForLink.trim()) {
    await upsertSourceCatalog(sourceForLink.trim());
  }
  patch.linkedAgencyId = link.linkedAgencyId;
  patch.linkedAgencyCode = link.linkedAgencyCode;
  patch.linkedAgencyName = link.linkedAgencyName;

  const mergedSource = sourceForLink.trim();
  const mergedDesc =
    typeof patch.description === "string" ? String(patch.description).trim() : String(existing.description ?? "").trim();
  const mergedTxn = (patch.txnDate as Date | undefined) ?? existing.txnDate;
  const mergedEff =
    patch.effectivePaymentDate !== undefined ? (patch.effectivePaymentDate as Date | null) : existing.effectivePaymentDate;
  const anchorDate = (mergedEff ?? mergedTxn) instanceof Date ? (mergedEff ?? mergedTxn)! : mergedTxn;
  const oldHa = existing.haCuocContext ?? null;
  const newWantsHa = isHaCuocSource(mergedSource);

  if (oldHa?.resolvedExistingSplit) {
    const code = parseCustomerCodeFromDescription(mergedDesc);
    if (body.chi !== undefined) {
      throw new ServiceError(409, "Không đổi số tiền Chi trên dòng đóng phần còn lại split — xóa dòng và nhập lại nếu cần.", {
        code: "HA_CUOC_SPLIT_RESOLVED",
      });
    }
    if (body.source !== undefined && !newWantsHa) {
      throw new ServiceError(409, "Không đổi nguồn khỏi Hạ Cước trên dòng đã gắn split đợt 2.", { code: "HA_CUOC_SPLIT_ROW_LOCKED" });
    }
    if (body.description !== undefined && code !== oldHa.customerCode) {
      throw new ServiceError(400, "Không đổi mã khách hàng trên dòng đóng split đợt 2.", { code: "HA_CUOC_SPLIT_ROW_LOCKED" });
    }
    if (body.txnDate !== undefined || body.effectivePaymentDate !== undefined) {
      const oldYm = vnCalendarYearMonth((existing.effectivePaymentDate ?? existing.txnDate) as Date);
      const newYm = vnCalendarYearMonth(anchorDate);
      if (oldYm.year !== newYm.year || oldYm.month !== newYm.month) {
        throw new ServiceError(409, "Không đổi tháng hạch toán trên dòng đóng split đợt 2.", { code: "HA_CUOC_SPLIT_ROW_LOCKED" });
      }
    }
  }

  try {
    if (oldHa && !newWantsHa) {
      await revertHaCuocContext(oldHa, id);
      patch.haCuocContext = null;
    } else if (!oldHa && newWantsHa) {
      const haCtx = (await applyHaCuocAfterThuChiSaved({
        entryId: id,
        source: mergedSource,
        description: mergedDesc,
        chi: typeof mergedChi === "number" ? mergedChi : null,
        thu: typeof mergedThu === "number" ? mergedThu : null,
        anchorDate,
      })) as HaCuocContextLean;
      patch.haCuocContext = haCtx;
    } else if (oldHa && newWantsHa) {
      if (oldHa.resolvedExistingSplit) {
        /* chỉ patch thường (bank/notes/…) — giữ nguyên haCuocContext */
      } else {
        const prevYm = vnCalendarYearMonth((existing.effectivePaymentDate ?? existing.txnDate) as Date);
        const nextYm = vnCalendarYearMonth(anchorDate);
        const prevCode = oldHa.customerCode;
        const nextCode = parseCustomerCodeFromDescription(mergedDesc);
        const sameTarget =
          nextCode === prevCode && prevYm.year === nextYm.year && prevYm.month === nextYm.month && oldHa.targetBillId;

        const onlyChiAmongHaFields =
          body.chi !== undefined &&
          body.description === undefined &&
          body.source === undefined &&
          body.txnDate === undefined &&
          body.effectivePaymentDate === undefined;

        const onlyDateSameMonth =
          (body.txnDate !== undefined || body.effectivePaymentDate !== undefined) &&
          body.chi === undefined &&
          body.description === undefined &&
          body.source === undefined &&
          sameTarget &&
          prevYm.year === nextYm.year &&
          prevYm.month === nextYm.month;

        if (sameTarget && onlyChiAmongHaFields && typeof mergedChi === "number") {
          const nextCtx = await updateHaCuocSplitAmountsIfNeeded({
            ctx: oldHa,
            newChi: mergedChi,
            anchorDate,
          });
          patch.haCuocContext = nextCtx;
        } else if (sameTarget && onlyDateSameMonth && oldHa.createdSplitEntryId) {
          await patchSplitPeriod(oldHa.createdSplitEntryId, 1, {
            scanDdMm: formatAnchorDdMmHoChiMinh(anchorDate),
          });
        } else if (
          mergedDesc === String(existing.description ?? "").trim() &&
          mergedSource === String(existing.source ?? "").trim() &&
          mergedChi === existing.chi &&
          mergedThu === existing.thu &&
          prevYm.year === nextYm.year &&
          prevYm.month === nextYm.month
        ) {
          /* không đổi nghiệp vụ Hạ Cước */
        } else {
          await revertHaCuocContext(oldHa, id);
          const haCtx = (await applyHaCuocAfterThuChiSaved({
            entryId: id,
            source: mergedSource,
            description: mergedDesc,
            chi: typeof mergedChi === "number" ? mergedChi : null,
            thu: typeof mergedThu === "number" ? mergedThu : null,
            anchorDate,
          })) as HaCuocContextLean;
          patch.haCuocContext = haCtx;
        }
      }
    }

    const updated = await updateAccountingThuChiDoc(id, patch as Parameters<typeof updateAccountingThuChiDoc>[1]);
    if (!updated) throw new ServiceError(404, "Không tìm thấy bản ghi");
    const changeParts: string[] = [];
    if (body.txnDate !== undefined) changeParts.push("ngày giao dịch");
    if (body.effectivePaymentDate !== undefined) changeParts.push("ngày thanh toán thực tế");
    if (body.description !== undefined) changeParts.push("nội dung");
    if (body.bank !== undefined) changeParts.push("ngân hàng");
    if (body.notes !== undefined) changeParts.push("ghi chú");
    if (body.thu !== undefined) changeParts.push("Thu");
    if (body.chi !== undefined) changeParts.push("Chi");
    if (body.source !== undefined) changeParts.push("Nguồn / neo đại lý");
    await writeAuditLog({
      actorUserId: resolveThuChiActorId(ctx?.actorUserId),
      action: "accounting.thu_chi_update",
      entityType: "AccountingThuChiEntry",
      entityId: new mongoose.Types.ObjectId(id),
      metadata: {
        entryId: id,
        changeSummary: changeParts.length ? changeParts.join(", ") : "cập nhật (không đổi trường nhận diện)",
        patchKeys: changeParts,
      },
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      actorEmail: ctx?.actorEmail,
      actorDisplayName: ctx?.actorDisplayName,
    });
    return { data: serializeDoc(updated as Record<string, unknown>), source: "mongodb" as const };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(500, getErrorMessage(error, "Không cập nhật được"));
  }
}

export async function previewHaCuocFromQuery(query: Record<string, unknown>) {
  await ensureDb();
  const customerCode = typeof query.customerCode === "string" ? query.customerCode.trim() : "";
  const amountOut = Number(query.amountOut);
  const anchorRaw = query.anchorDate;
  if (!customerCode) throw new ServiceError(400, "Thiếu customerCode", { code: "HA_CUOC_PREVIEW_MISSING_CODE" });
  if (!Number.isFinite(amountOut)) {
    throw new ServiceError(400, "amountOut không hợp lệ", { code: "HA_CUOC_PREVIEW_MISSING_AMOUNT" });
  }
  const anchor =
    anchorRaw instanceof Date
      ? anchorRaw
      : typeof anchorRaw === "string" && anchorRaw.trim()
        ? new Date(anchorRaw)
        : null;
  if (!anchor || Number.isNaN(anchor.getTime())) {
    throw new ServiceError(400, "anchorDate không hợp lệ (ISO)", { code: "HA_CUOC_PREVIEW_MISSING_DATE" });
  }
  return previewHaCuoc({ customerCode, amountOut, anchorDate: anchor });
}

export async function removeThuChi(id: string, ctx?: ThuChiAuditContext) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const snapshot = await findAccountingThuChiById(id);
  if (snapshot?.haCuocContext) {
    await revertHaCuocContext(snapshot.haCuocContext, id);
  }
  const deleted = await deleteAccountingThuChiDoc(id);
  if (!deleted) throw new ServiceError(404, "Không tìm thấy bản ghi");
  await writeAuditLog({
    actorUserId: resolveThuChiActorId(ctx?.actorUserId),
    action: "accounting.thu_chi_delete",
    entityType: "AccountingThuChiEntry",
    entityId: new mongoose.Types.ObjectId(id),
    metadata: {
      entryId: id,
      source: snapshot?.source ?? "",
      thuVnd: snapshot?.thu ?? null,
      chiVnd: snapshot?.chi ?? null,
      linkedAgencyCode: snapshot?.linkedAgencyCode ?? null,
      changeSummary: `Xóa dòng thu chi (nguồn «${String(snapshot?.source ?? "").trim() || "—"}», Thu/Chi đã lưu trong metadata).`,
    },
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    actorEmail: ctx?.actorEmail,
    actorDisplayName: ctx?.actorDisplayName,
  });
  return { ok: true, source: "mongodb" as const };
}

export async function listThuChiBankCatalog(query: Record<string, unknown>) {
  await ensureDb();
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const limit = Math.min(50, toPositiveInt(query.limit, 30));
  try {
    const items = await listBankCatalog({ q, limit });
    return {
      data: {
        items: items.map((it) => ({
          _id: String(it._id),
          bank: it.bankDisplay,
          usageCount: Number(it.usageCount ?? 0),
          lastUsedAt: it.lastUsedAt instanceof Date ? it.lastUsedAt.toISOString() : new Date().toISOString(),
        })),
      },
      source: "mongodb" as const,
    };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được danh mục ngân hàng"), { data: { items: [] } });
  }
}

export async function createThuChiBankCatalog(body: Record<string, unknown>) {
  await ensureDb();
  const bank = typeof body.bank === "string" ? body.bank.trim() : "";
  if (!bank) throw new ServiceError(400, "bank không hợp lệ");
  await upsertBankCatalog(bank);
  return { ok: true, source: "mongodb" as const };
}

export async function updateThuChiBankCatalog(id: string, body: Record<string, unknown>) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const bank = typeof body.bank === "string" ? body.bank.trim() : "";
  if (!bank) throw new ServiceError(400, "bank không hợp lệ");
  const ok = await updateBankCatalogById(id, bank);
  if (!ok) throw new ServiceError(404, "Không tìm thấy ngân hàng");
  return { ok: true, source: "mongodb" as const };
}

export async function deleteThuChiBankCatalog(id: string) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const ok = await deleteBankCatalogById(id);
  if (!ok) throw new ServiceError(404, "Không tìm thấy ngân hàng");
  return { ok: true, source: "mongodb" as const };
}

export async function listThuChiSourceCatalog(query: Record<string, unknown>) {
  await ensureDb();
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const limit = Math.min(50, toPositiveInt(query.limit, 30));
  try {
    const items = await listSourceCatalog({ q, limit });
    return {
      data: {
        items: items.map((it) => ({
          _id: String(it._id),
          source: it.sourceDisplay,
          usageCount: Number(it.usageCount ?? 0),
          lastUsedAt: it.lastUsedAt instanceof Date ? it.lastUsedAt.toISOString() : new Date().toISOString(),
          kind: it.kind ?? null,
          system: Boolean(it.system),
        })),
      },
      source: "mongodb" as const,
    };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được danh mục nguồn ngoài"), { data: { items: [] } });
  }
}

export async function createThuChiSourceCatalog(body: Record<string, unknown>) {
  await ensureDb();
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) throw new ServiceError(400, "source không hợp lệ");
  await upsertSourceCatalog(source);
  return { ok: true, source: "mongodb" as const };
}

export async function updateThuChiSourceCatalog(id: string, body: Record<string, unknown>) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const cur = await getSourceCatalogEntryById(id);
  if (cur?.system) {
    throw new ServiceError(403, "Không được sửa nguồn hệ thống (Hạ Cước).", { code: "SOURCE_SYSTEM_LOCKED" });
  }
  const source = typeof body.source === "string" ? body.source.trim() : "";
  if (!source) throw new ServiceError(400, "source không hợp lệ");
  const ok = await updateSourceCatalogById(id, source);
  if (!ok) throw new ServiceError(404, "Không tìm thấy nguồn ngoài");
  return { ok: true, source: "mongodb" as const };
}

export async function deleteThuChiSourceCatalog(id: string) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const cur = await getSourceCatalogEntryById(id);
  if (cur?.system) {
    throw new ServiceError(403, "Không được xóa nguồn hệ thống (Hạ Cước).", { code: "SOURCE_SYSTEM_LOCKED" });
  }
  const ok = await deleteSourceCatalogById(id);
  if (!ok) throw new ServiceError(404, "Không tìm thấy nguồn ngoài");
  return { ok: true, source: "mongodb" as const };
}
