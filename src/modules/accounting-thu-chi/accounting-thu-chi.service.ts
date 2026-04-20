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
  updateAccountingThuChiDoc,
} from "@/modules/accounting-thu-chi/accounting-thu-chi.repository";
import {
  deleteBankCatalogById,
  listBankCatalog,
  updateBankCatalogById,
  upsertBankCatalog,
} from "@/modules/accounting-thu-chi/user-bank-preference.repository";

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
};

function resolveThuChiActorId(raw?: string | null): mongoose.Types.ObjectId {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s && mongoose.isValidObjectId(s)) return new mongoose.Types.ObjectId(s);
  return new mongoose.Types.ObjectId(ELEC_SYSTEM_AUDIT_ACTOR_ID);
}

/** Ghi nhận ngân hàng vào danh mục hệ thống — lỗi không làm fail luồng thu chi. */
async function recordBankCatalogSafe(bankTrimmed: string): Promise<void> {
  const trimmed = bankTrimmed.trim().slice(0, 120);
  if (!trimmed) return;
  try {
    await ensureDb();
    await upsertBankCatalog(trimmed);
  } catch {
    /* ignore */
  }
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

export async function listThuChi(query: Record<string, unknown>) {
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

    const { items, total } = await listAccountingThuChiEntries({
      from,
      to,
      agencyCode,
      skip: (page - 1) * pageSize,
      limit: pageSize,
    });

    const data = items.map((row, idx) => ({
      _id: String(row._id),
      stt: (page - 1) * pageSize + idx + 1,
      txnDate: row.txnDate.toISOString(),
      description: row.description ?? "",
      source: row.source ?? "",
      bank: row.bank ?? "",
      thu: row.thu ?? null,
      chi: row.chi ?? null,
      notes: row.notes ?? "",
      linkedAgencyId: row.linkedAgencyId ? String(row.linkedAgencyId) : null,
      linkedAgencyCode: row.linkedAgencyCode ?? null,
      linkedAgencyName: row.linkedAgencyName ?? null,
      createdAt: row.createdAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }));

    return { data, total, page, pageSize, source: "mongodb" as const };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"));
  }
}

export async function getThuChiById(id: string) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const row = await findAccountingThuChiById(id);
  if (!row) throw new ServiceError(404, "Không tìm thấy bản ghi");
  return {
    data: {
      _id: String(row._id),
      txnDate: row.txnDate.toISOString(),
      description: row.description ?? "",
      source: row.source ?? "",
      bank: row.bank ?? "",
      thu: row.thu ?? null,
      chi: row.chi ?? null,
      notes: row.notes ?? "",
      linkedAgencyId: row.linkedAgencyId ? String(row.linkedAgencyId) : null,
      linkedAgencyCode: row.linkedAgencyCode ?? null,
      linkedAgencyName: row.linkedAgencyName ?? null,
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

  const description = typeof body.description === "string" ? body.description : "";
  const source = typeof body.source === "string" ? body.source : "";
  const bank = typeof body.bank === "string" ? body.bank : "";
  const notes = typeof body.notes === "string" ? body.notes : "";
  const thu = parseMoneyCreate(body.thu, "Thu");
  const chi = parseMoneyCreate(body.chi, "Chi");
  assertPositiveThuOrChi(thu ?? 0, chi ?? 0);

  const link = await resolveAgencyLinkForSource(source);

  try {
    const doc = await createAccountingThuChiDoc({
      txnDate,
      description: description.trim(),
      source: source.trim(),
      bank: bank.trim(),
      thu,
      chi,
      notes: notes.trim(),
      linkedAgencyId: link.linkedAgencyId,
      linkedAgencyCode: link.linkedAgencyCode,
      linkedAgencyName: link.linkedAgencyName,
    });
    const row = doc.toObject() as Record<string, unknown>;
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
        changeSummary: `Tạo dòng thu chi; nội dung tóm tắt: ${description.trim().slice(0, 200)}`,
      },
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    });
    await recordBankCatalogSafe(bank.trim());
    return { data: serializeDoc(row), source: "mongodb" as const };
  } catch (error) {
    throw new ServiceError(500, getErrorMessage(error, "Không lưu được"));
  }
}

function serializeDoc(row: Record<string, unknown>) {
  return {
    _id: String(row._id),
    txnDate: (row.txnDate as Date).toISOString(),
    description: String(row.description ?? ""),
    source: String(row.source ?? ""),
    bank: String(row.bank ?? ""),
    thu: row.thu == null ? null : Number(row.thu),
    chi: row.chi == null ? null : Number(row.chi),
    notes: String(row.notes ?? ""),
    linkedAgencyId: row.linkedAgencyId ? String(row.linkedAgencyId) : null,
    linkedAgencyCode: row.linkedAgencyCode ? String(row.linkedAgencyCode) : null,
    linkedAgencyName: row.linkedAgencyName ? String(row.linkedAgencyName) : null,
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
  const link = await resolveAgencyLinkForSource(sourceForLink);
  patch.linkedAgencyId = link.linkedAgencyId;
  patch.linkedAgencyCode = link.linkedAgencyCode;
  patch.linkedAgencyName = link.linkedAgencyName;

  try {
    const updated = await updateAccountingThuChiDoc(id, patch as Parameters<typeof updateAccountingThuChiDoc>[1]);
    if (!updated) throw new ServiceError(404, "Không tìm thấy bản ghi");
    const changeParts: string[] = [];
    if (body.txnDate !== undefined) changeParts.push("ngày giao dịch");
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
    });
    const finalBank = String((updated as { bank?: string }).bank ?? "").trim();
    await recordBankCatalogSafe(finalBank);
    return { data: serializeDoc(updated as Record<string, unknown>), source: "mongodb" as const };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(500, getErrorMessage(error, "Không cập nhật được"));
  }
}

export async function removeThuChi(id: string, ctx?: ThuChiAuditContext) {
  await ensureDb();
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  const snapshot = await findAccountingThuChiById(id);
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
  });
  return { ok: true, source: "mongodb" as const };
}

export async function listBankCatalogEntries(query: Record<string, unknown>) {
  await ensureDb();
  let limit = 20;
  if (query.limit != null && query.limit !== "") {
    const n = Number(query.limit);
    if (Number.isFinite(n)) {
      limit = Math.min(50, Math.max(1, Math.trunc(n)));
    }
  }
  const qRaw = typeof query.q === "string" ? query.q.trim() : "";
  if (qRaw.length > 120) throw new ServiceError(400, "Tham số q quá dài");

  try {
    const items = await listBankCatalog({
      q: qRaw || undefined,
      limit,
    });
    return {
      data: {
        items: items.map((row) => ({
          _id: String(row._id),
          bank: row.bankDisplay,
          usageCount: row.usageCount,
          lastUsedAt: row.lastUsedAt.toISOString(),
        })),
      },
      source: "mongodb" as const,
    };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được danh mục ngân hàng"));
  }
}

export async function createBankCatalogEntry(body: Record<string, unknown>) {
  await ensureDb();
  const bank = typeof body.bank === "string" ? body.bank.trim() : "";
  if (!bank) throw new ServiceError(400, "bank không được để trống");
  if (bank.length > 120) throw new ServiceError(400, "bank quá dài");
  try {
    await upsertBankCatalog(bank);
    return { ok: true as const, source: "mongodb" as const };
  } catch (error) {
    throw new ServiceError(500, getErrorMessage(error, "Không lưu được danh mục ngân hàng"));
  }
}

export async function updateBankCatalogEntry(id: string, body: Record<string, unknown>) {
  await ensureDb();
  const bank = typeof body.bank === "string" ? body.bank.trim() : "";
  if (!bank) throw new ServiceError(400, "bank không được để trống");
  if (bank.length > 120) throw new ServiceError(400, "bank quá dài");
  try {
    const ok = await updateBankCatalogById(id, bank);
    if (!ok) throw new ServiceError(404, "Không tìm thấy ngân hàng cần cập nhật");
    return { ok: true as const, source: "mongodb" as const };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(500, getErrorMessage(error, "Không cập nhật được danh mục ngân hàng"));
  }
}

export async function removeBankCatalogEntry(id: string) {
  await ensureDb();
  try {
    const ok = await deleteBankCatalogById(id);
    if (!ok) throw new ServiceError(404, "Không tìm thấy ngân hàng cần xóa");
    return { ok: true as const, source: "mongodb" as const };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(500, getErrorMessage(error, "Không xóa được ngân hàng"));
  }
}
