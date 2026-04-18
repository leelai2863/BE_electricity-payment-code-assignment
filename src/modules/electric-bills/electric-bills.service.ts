import mongoose from "mongoose";
import { writeAuditLog } from "@/lib/audit";
import { serializeElectricBill, billHasIncompletePeriod } from "@/lib/electric-bill-serialize";
import { isPeriodReadyForDealCompletion } from "@/lib/electric-bill-completion";
import { periodsDtoToMongoSchema } from "@/lib/electric-bill-mongo-periods";
import { scanDdMmIsNotFuture } from "@/lib/scan-ddmm";
import {
  resolveRefundFeePctFromLine,
  resolveRefundRuleFromLine,
  resolveRefundFeePctFromRulesByStatus,
} from "@/lib/refund-fee-resolve";
import { refundAnchorDateUtc } from "@/lib/refund-anchor-date";
import type {
  MailQueueLineDto,
  RefundLineStateDto,
} from "@/types/electric-bill";
import {
  findUnassignedCandidateBills,
  countInvoiceList,
  findInvoiceListDocs,
  aggregateInvoiceFacets,
  findBillsLean,
  findBillsByYearMonth,
  findMailQueueBills,
  findRefundLineStates,
  findRefundFeeRules,
  createRefundFeeRuleDoc,
  findRefundFeeRuleById,
  updateRefundFeeRuleById,
  deleteRefundFeeRuleById,
  findRefundLineStateOne,
  upsertRefundLineStateDoc,
  findAssignedCodeOne,
  upsertAssignedCodeDoc,
  deleteAssignedCodeDoc,
  findAssignedCodesList,
  findElectricBillById,
  assignElectricBillIfAvailable,
  markVoucherCodeCompleted,
  newObjectId,
} from "@/modules/electric-bills/electric-bills.repository";
import {
  ServiceError,
  type AmountFilter,
  type PatchBody,
  type RefundLinePatchBodyItem,
  VALID_AMOUNT_FILTERS,
  ensureDb,
  getErrorMessage,
  nowMs,
  billTotalAmount,
  passesAmountFilter,
  completedAmountPeriods,
  parseInvoiceListParams,
  buildInvoiceListMatch,
  invoiceListSort,
  applyPeriodPatches,
  syncBillLevelFromPeriods,
} from "@/modules/electric-bills/electric-bills.helpers";
import {
  serializeRefundFeeRuleDoc,
  serializeRefundLineStateDoc,
} from "@/modules/electric-bills/electric-bills.mappers";

async function checkAssignedCodeConflict(
  customerCode: string,
  amount: number,
  year: number,
  month: number,
  incomingAgencyId: string
): Promise<string | null> {
  const existing = await findAssignedCodeOne({ customerCode, amount, year, month });
  if (!existing) return null;
  if (existing.agencyId === incomingAgencyId) return null;
  return existing.agencyName;
}

export { ServiceError };

function omitEvnField<T extends { evn?: unknown }>(row: T): Omit<T, "evn"> {
  const { evn: _evn, ...rest } = row;
  return rest;
}

export async function listUnassignedBills(query: Record<string, unknown>) {
  const rawAmountFilter = typeof query.amountFilter === "string" ? query.amountFilter : null;
  const amountFilter: AmountFilter | null =
    rawAmountFilter && VALID_AMOUNT_FILTERS.has(rawAmountFilter)
      ? (rawAmountFilter as AmountFilter)
      : null;

  await ensureDb();

  try {
    const docs = await findUnassignedCandidateBills();

    let data = docs
      .map((d) => serializeElectricBill(d as Record<string, unknown>))
      .filter((bill) =>
        bill.periods.some((p) => p.amount != null && (!p.assignedAgencyId || !p.assignedAgencyId.trim()))
      );

    if (amountFilter) {
      data = data.filter((bill) => passesAmountFilter(billTotalAmount(bill), amountFilter));
    }

    return { data, source: "mongodb", amountFilter };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"), { data: [] });
  }
}

export async function getInvoiceList(query: Record<string, unknown>) {
  const params = parseInvoiceListParams(query);
  const match = buildInvoiceListMatch(params);
  const sort = invoiceListSort(params.sortBy, params.sortDir);
  const dbStarted = nowMs();

  await ensureDb();

  try {
    const cursorMatch: Record<string, unknown> = { ...match };

    if (params.cursor && params.sortBy === "_id") {
      const dir = params.sortDir === "desc" ? "$lt" : "$gt";
      const cursorAnd = (cursorMatch.$and as Record<string, unknown>[] | undefined) ?? [];
      cursorAnd.push({ _id: { [dir]: new mongoose.Types.ObjectId(params.cursor) } });
      cursorMatch.$and = cursorAnd;
    }

    const [total, docsRaw] = await Promise.all([
      countInvoiceList(match),
      findInvoiceListDocs({
        match: cursorMatch,
        sort,
        skip: params.cursor ? 0 : (params.page - 1) * params.pageSize,
        limit: params.pageSize + 1,
      }),
    ]);

    const dbQueryMs = nowMs() - dbStarted;
    const hasNext = docsRaw.length > params.pageSize;
    const docs = hasNext ? docsRaw.slice(0, params.pageSize) : docsRaw;

    const serializeStarted = nowMs();
    const items = docs.map((d) => serializeElectricBill(d as Record<string, unknown>));
    const serializeMs = nowMs() - serializeStarted;
    const nextCursor = hasNext ? String(docs[docs.length - 1]?._id ?? "") : null;

    let aggregations: Record<string, unknown> = {
      total,
      incomplete: items.filter(billHasIncompletePeriod).length,
      months: [...new Set(items.map((x) => `${x.year}-${x.month}`))].length,
    };

    if (params.includeFacets) {
      const facetsStarted = nowMs();
      const facetRows = await aggregateInvoiceFacets(match);
      const facets = facetRows[0] ?? {};

      aggregations = {
        ...aggregations,
        facets: {
          customerCode: (facets.customerCodes ?? []).filter(Boolean).slice(0, 500),
          assignedAgencyName: (facets.assignedAgencyNames ?? []).filter(Boolean).slice(0, 500),
          scanDdMm: (facets.scanDdMms ?? []).filter(Boolean).slice(0, 500),
          month: (facets.months ?? [])
            .filter((x: unknown) => Number.isInteger(Number(x)))
            .sort((a: number, b: number) => a - b),
          year: (facets.years ?? [])
            .filter((x: unknown) => Number.isInteger(Number(x)))
            .sort((a: number, b: number) => a - b),
        },
        facetsMs: Math.round(nowMs() - facetsStarted),
      };
    }

    const payload = {
      items,
      data: items,
      total,
      hasNext,
      nextCursor,
      page: params.page,
      pageSize: params.pageSize,
      aggregations,
      source: "mongodb",
      query: {
        includeArchived: params.includeArchived,
        done: params.done,
        sortBy: params.sortBy,
        sortDir: params.sortDir,
        updatedAfter: params.updatedAfter?.toISOString() ?? null,
      },
      metrics: {
        dbQueryMs: Math.round(dbQueryMs),
        serializeMs: Math.round(serializeMs),
        responseBytes: 0,
      },
    };

    const responseBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    payload.metrics.responseBytes = responseBytes;

    console.info("[electric-bills.invoice-list]", {
      total,
      returned: items.length,
      hasNext,
      dbQueryMs: payload.metrics.dbQueryMs,
      serializeMs: payload.metrics.serializeMs,
      responseBytes,
    });

    return payload;
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"), {
      items: [],
      data: [],
      total: 0,
      hasNext: false,
      nextCursor: null,
      page: params.page,
      pageSize: params.pageSize,
      aggregations: {},
    });
  }
}

export async function getInvoiceCompletedMonths() {
  await ensureDb();

  try {
    const docs = await findBillsLean({}, { year: -1, month: -1 }, 5000);
    const seen = new Map<string, { year: number; month: number }>();

    for (const d of docs) {
      const bill = serializeElectricBill(d as Record<string, unknown>);
      if (completedAmountPeriods(bill.periods).length === 0) continue;
      const k = `${bill.year}-${bill.month}`;
      if (!seen.has(k)) seen.set(k, { year: bill.year, month: bill.month });
    }

    const data = [...seen.values()].sort((a, b) => b.year - a.year || b.month - a.month);

    return {
      data: data.map(({ year, month }) => ({ year, month, label: `T${month}/${year}` })),
      source: "mongodb",
    };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"), { data: [] });
  }
}

export async function getInvoiceCompleted(query: Record<string, unknown>) {
  const year = Number(query.year);
  const month = Number(query.month);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new ServiceError(400, "Tham số year và month (1–12) là bắt buộc", { data: [] });
  }

  await ensureDb();

  try {
    const docs = await findBillsByYearMonth(year, month);
    const data = docs
      .map((d) => serializeElectricBill(d as Record<string, unknown>))
      .map((bill) => ({ ...bill, periods: completedAmountPeriods(bill.periods) }))
      .map((bill) => omitEvnField(bill))
      .filter((bill) => bill.periods.length > 0);

    return { data, source: "mongodb" };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"), { data: [] });
  }
}

export async function getMailQueue() {
  await ensureDb();

  try {
    const [docs, lineStateDocs, feeRuleDocs] = await Promise.all([
      findMailQueueBills(),
      findRefundLineStates(),
      findRefundFeeRules(),
    ]);

    const lines: MailQueueLineDto[] = [];
    const resolvedLineStates: RefundLineStateDto[] = [];
    const lineStateMap = new Map<string, RefundLineStateDto>();
    for (const x of lineStateDocs) {
      const dto = serializeRefundLineStateDoc(x);
      lineStateMap.set(`${dto.billId}_k${dto.ky}`, dto);
    }
    const feeRules = feeRuleDocs.map((x) => serializeRefundFeeRuleDoc(x));

    for (const d of docs) {
      const bill = serializeElectricBill(d as Record<string, unknown>);
      for (const p of bill.periods) {
        if (!p.dealCompletedAt || p.amount == null) continue;

        lines.push({
          billId: bill._id,
          customerCode: bill.customerCode,
          monthLabel: bill.monthLabel,
          month: bill.month,
          year: bill.year,
          company: bill.company,
          ky: p.ky,
          amount: p.amount,
          assignedAgencyName: p.assignedAgencyName,
          ca: p.ca,
          dlGiaoName: p.dlGiaoName,
          customerName: p.customerName,
          scanDdMm: p.scanDdMm,
          cardType: p.cardType,
          resolvedStatus: null,
          resolvedPhiPct: null,
          dealCompletedAt: p.dealCompletedAt,
        });
      }
    }

    for (const line of lines) {
      const agencyName = (line.assignedAgencyName ?? "").trim() || "(Chưa có đại lý)";
      const agencyRules = feeRules.filter((r) => r.agencyName.trim().toUpperCase() === agencyName.trim().toUpperCase());
      const hasManualRule = agencyRules.some((r) => r.isActive && r.conditionType === "manual");
      const resolved = await resolveRefundRuleFromLine(agencyName, {
        year: line.year,
        month: line.month,
        scanDdMm: line.scanDdMm,
        dealCompletedAt: line.dealCompletedAt,
        amount: line.amount,
        cardType: line.cardType,
      });
      line.resolvedStatus = resolved?.statusLabel ?? null;
      line.resolvedPhiPct = resolved?.pct ?? null;
      const stateKey = `${line.billId}_k${line.ky}`;
      const existing = lineStateMap.get(stateKey);
      const anchor = refundAnchorDateUtc({
        year: line.year,
        month: line.month,
        scanDdMm: line.scanDdMm,
        dealCompletedAt: line.dealCompletedAt,
      });
      if (hasManualRule) {
        const manualStatus = (existing?.status ?? "").trim();
        const manualPct =
          manualStatus ? resolveRefundFeePctFromRulesByStatus(feeRules, agencyName, manualStatus, anchor) : null;
        line.resolvedStatus = manualStatus || null;
        line.resolvedPhiPct = manualPct;
      }
      resolvedLineStates.push({
        billId: line.billId,
        ky: line.ky,
        agencyName,
        status: line.resolvedStatus ?? "",
        phiPct: line.resolvedPhiPct,
        daHoan: existing?.daHoan ?? 0,
        updatedAt: existing?.updatedAt ?? new Date().toISOString(),
      });
    }

    lines.sort((a, b) => new Date(b.dealCompletedAt).getTime() - new Date(a.dealCompletedAt).getTime());

    return {
      data: lines,
      refundLineStates: resolvedLineStates,
      refundFeeRules: feeRules,
      source: "mongodb",
    };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"), { data: [] });
  }
}

export async function createRefundFeeRule(body: {
  agencyName?: string;
  feeName?: string;
  statusLabel?: string;
  conditionType?: "amount" | "cardType" | "manual";
  amountMin?: number | null;
  amountMax?: number | null;
  cardType?: string | null;
  pct?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  isActive?: boolean;
}) {
  const agencyName = typeof body.agencyName === "string" ? body.agencyName.trim() : "";
  const feeName = typeof body.feeName === "string" ? body.feeName.trim() : "";
  const statusLabel = typeof body.statusLabel === "string" ? body.statusLabel.trim().toUpperCase() : "";
  const conditionType =
    body.conditionType === "amount" || body.conditionType === "cardType" || body.conditionType === "manual"
      ? body.conditionType
      : "manual";
  const amountMin =
    body.amountMin === null || body.amountMin === undefined ? null : Number(body.amountMin);
  const amountMax =
    body.amountMax === null || body.amountMax === undefined ? null : Number(body.amountMax);
  const cardType =
    body.cardType == null || !String(body.cardType).trim()
      ? null
      : String(body.cardType).trim().toUpperCase();
  const pct = typeof body.pct === "number" ? body.pct : Number(body.pct);

  if (!agencyName || !statusLabel || !Number.isFinite(pct)) {
    throw new ServiceError(400, "Cần agencyName, statusLabel và pct hợp lệ");
  }
  if (conditionType === "amount") {
    if (amountMin != null && !Number.isFinite(amountMin)) {
      throw new ServiceError(400, "amountMin không hợp lệ");
    }
    if (amountMax != null && !Number.isFinite(amountMax)) {
      throw new ServiceError(400, "amountMax không hợp lệ");
    }
    if (amountMin != null && amountMax != null && amountMin > amountMax) {
      throw new ServiceError(400, "amountMin không được lớn hơn amountMax");
    }
  }
  if (conditionType === "cardType" && !cardType) {
    throw new ServiceError(400, "cardType là bắt buộc khi conditionType=cardType");
  }

  const effectiveFrom =
    typeof body.effectiveFrom === "string" && body.effectiveFrom.trim()
      ? new Date(body.effectiveFrom)
      : new Date();

  if (Number.isNaN(effectiveFrom.getTime())) {
    throw new ServiceError(400, "effectiveFrom không hợp lệ");
  }
  const effectiveTo =
    body.effectiveTo == null || !String(body.effectiveTo).trim() ? null : new Date(String(body.effectiveTo));
  if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
    throw new ServiceError(400, "effectiveTo không hợp lệ");
  }
  if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    throw new ServiceError(400, "effectiveTo không được nhỏ hơn effectiveFrom");
  }

  await ensureDb();

  try {
    const doc = await createRefundFeeRuleDoc({
      agencyName,
      feeName,
      statusLabel,
      conditionType,
      amountMin: conditionType === "amount" ? amountMin : null,
      amountMax: conditionType === "amount" ? amountMax : null,
      cardType: conditionType === "cardType" ? cardType : null,
      pct,
      effectiveFrom,
      effectiveTo,
      isActive: body.isActive ?? true,
    });

    return {
      data: serializeRefundFeeRuleDoc(
        doc.toObject() as Parameters<typeof serializeRefundFeeRuleDoc>[0]
      ),
    };
  } catch (error) {
    throw new ServiceError(500, getErrorMessage(error, "Không lưu được"));
  }
}

export async function listRefundFeeRules(query: Record<string, unknown>) {
  const agencyName = typeof query.agencyName === "string" ? query.agencyName.trim() : "";
  const includeInactive = String(query.includeInactive ?? "").trim().toLowerCase() === "true";
  await ensureDb();
  try {
    const filter: Record<string, unknown> = {};
    if (agencyName) filter.agencyName = agencyName;
    if (!includeInactive) filter.isActive = true;
    const docs = await findRefundFeeRules(filter);
    return { data: docs.map((x) => serializeRefundFeeRuleDoc(x)), source: "mongodb" };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"), { data: [] });
  }
}

export async function updateRefundFeeRule(
  id: string,
  body: {
    feeName?: string;
    statusLabel?: string;
    conditionType?: "amount" | "cardType" | "manual";
    amountMin?: number | null;
    amountMax?: number | null;
    cardType?: string | null;
    pct?: number;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    isActive?: boolean;
  }
) {
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  await ensureDb();
  const existing = await findRefundFeeRuleById(id);
  if (!existing) throw new ServiceError(404, "Không tìm thấy rule phí");

  const conditionType =
    body.conditionType === "amount" || body.conditionType === "cardType" || body.conditionType === "manual"
      ? body.conditionType
      : (existing.conditionType as "amount" | "cardType" | "manual");
  const amountMin =
    body.amountMin === undefined ? existing.amountMin ?? null : body.amountMin == null ? null : Number(body.amountMin);
  const amountMax =
    body.amountMax === undefined ? existing.amountMax ?? null : body.amountMax == null ? null : Number(body.amountMax);
  if (conditionType === "amount" && amountMin != null && amountMax != null && amountMin > amountMax) {
    throw new ServiceError(400, "amountMin không được lớn hơn amountMax");
  }
  const effectiveFrom =
    body.effectiveFrom === undefined ? existing.effectiveFrom : new Date(body.effectiveFrom);
  if (Number.isNaN(new Date(effectiveFrom).getTime())) throw new ServiceError(400, "effectiveFrom không hợp lệ");
  const effectiveTo =
    body.effectiveTo === undefined
      ? existing.effectiveTo ?? null
      : body.effectiveTo == null || !String(body.effectiveTo).trim()
        ? null
        : new Date(String(body.effectiveTo));
  if (effectiveTo && Number.isNaN(new Date(effectiveTo).getTime())) {
    throw new ServiceError(400, "effectiveTo không hợp lệ");
  }

  const updated = await updateRefundFeeRuleById(id, {
    feeName: body.feeName === undefined ? existing.feeName : body.feeName.trim(),
    statusLabel: body.statusLabel === undefined ? existing.statusLabel : body.statusLabel.trim().toUpperCase(),
    conditionType,
    amountMin: conditionType === "amount" ? amountMin : null,
    amountMax: conditionType === "amount" ? amountMax : null,
    cardType:
      conditionType === "cardType"
        ? body.cardType === undefined
          ? existing.cardType ?? null
          : body.cardType == null
            ? null
            : String(body.cardType).trim().toUpperCase()
        : null,
    pct: body.pct === undefined ? existing.pct : Number(body.pct),
    effectiveFrom: new Date(effectiveFrom),
    effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
    isActive: body.isActive === undefined ? Boolean(existing.isActive ?? true) : Boolean(body.isActive),
  });
  if (!updated) throw new ServiceError(404, "Không tìm thấy rule phí");
  return { data: serializeRefundFeeRuleDoc(updated.toObject()), source: "mongodb" };
}

export async function removeRefundFeeRule(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ServiceError(400, "id không hợp lệ");
  await ensureDb();
  const deleted = await deleteRefundFeeRuleById(id);
  if (!deleted) throw new ServiceError(404, "Không tìm thấy rule phí");
  return { data: { deletedId: id }, source: "mongodb" };
}

export async function patchRefundLineStates(body: { items?: RefundLinePatchBodyItem[] }) {
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    throw new ServiceError(400, "Cần mảng items");
  }

  if (items.length > 500) {
    throw new ServiceError(400, "Tối đa 500 dòng mỗi lần");
  }

  await ensureDb();

  try {
    const out: RefundLineStateDto[] = [];
    const feeRules = (await findRefundFeeRules({ isActive: true })).map((x) => serializeRefundFeeRuleDoc(x));

    for (const it of items) {
      if (!mongoose.isValidObjectId(it.billId)) {
        throw new ServiceError(400, `billId không hợp lệ: ${it.billId}`);
      }

      const ky = Number(it.ky);
      if (ky !== 1 && ky !== 2 && ky !== 3) {
        throw new ServiceError(400, "ky phải là 1, 2 hoặc 3");
      }

      const agencyName = typeof it.agencyName === "string" ? it.agencyName.trim() : "";
      if (!agencyName) {
        throw new ServiceError(400, "Thiếu agencyName");
      }

      const year = Number(it.year);
      const month = Number(it.month);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        throw new ServiceError(400, "year/month không hợp lệ");
      }

      const anchorInput = {
        year,
        month,
        scanDdMm: it.scanDdMm ?? null,
        dealCompletedAt: typeof it.dealCompletedAt === "string" ? it.dealCompletedAt : "",
      };

      const existing = await findRefundLineStateOne(it.billId, ky);
      const curDaHoan = typeof existing?.daHoan === "number" ? existing.daHoan : 0;
      const newDaHoan = it.daHoan !== undefined ? Number(it.daHoan) || 0 : curDaHoan;
      const anchor = refundAnchorDateUtc(anchorInput);
      const hasManualRule = feeRules.some(
        (r) =>
          r.isActive &&
          r.conditionType === "manual" &&
          r.agencyName.trim().toUpperCase() === agencyName.trim().toUpperCase()
      );
      let newStatus = "";
      let newPhi: number | null = null;
      if (hasManualRule) {
        newStatus =
          it.status !== undefined
            ? String(it.status).trim().toUpperCase()
            : String(existing?.status ?? "").trim().toUpperCase();
        newPhi = newStatus ? resolveRefundFeePctFromRulesByStatus(feeRules, agencyName, newStatus, anchor) : null;
      } else {
        const resolved = await resolveRefundRuleFromLine(agencyName, {
          ...anchorInput,
          amount: it.amount ?? null,
          cardType: it.cardType ?? null,
        });
        newStatus = resolved?.statusLabel ?? "";
        newPhi = resolved?.pct ?? null;
      }

      const doc = await upsertRefundLineStateDoc(it.billId, ky, {
        agencyName,
        status: newStatus,
        phiPct: newPhi,
        daHoan: newDaHoan,
      });

      if (doc) out.push(serializeRefundLineStateDoc(doc.toObject()));
    }

    return { data: { items: out }, source: "mongodb" };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(500, getErrorMessage(error, "Cập nhật không thành công"));
  }
}

export async function migrateRefundLocalStorage(body: {
  feeRules?: Array<{ agencyName: string; statusLabel: string; pct: number; effectiveFrom: string }>;
  lineItems?: RefundLinePatchBodyItem[];
}) {
  const feeRulesIn = Array.isArray(body.feeRules) ? body.feeRules : [];
  const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];

  await ensureDb();

  try {
    let rulesInserted = 0;

    for (const r of feeRulesIn) {
      const agencyName = String(r.agencyName ?? "").trim();
      const statusLabel = String(r.statusLabel ?? "").trim().toUpperCase();
      const pct = Number(r.pct);
      if (!agencyName || !statusLabel || !Number.isFinite(pct)) continue;

      const eff = r.effectiveFrom ? new Date(r.effectiveFrom) : new Date("2020-01-01T00:00:00.000Z");
      if (Number.isNaN(eff.getTime())) continue;

      await createRefundFeeRuleDoc({
        agencyName,
        statusLabel,
        pct,
        effectiveFrom: eff,
      });

      rulesInserted += 1;
    }

    const outStates: RefundLineStateDto[] = [];

    for (const it of lineItems) {
      if (!mongoose.isValidObjectId(it.billId)) continue;

      const ky = Number(it.ky);
      if (ky !== 1 && ky !== 2 && ky !== 3) continue;

      const agencyName = String(it.agencyName ?? "").trim();
      if (!agencyName) continue;

      const year = Number(it.year);
      const month = Number(it.month);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;

      const anchorInput = {
        year,
        month,
        scanDdMm: it.scanDdMm ?? null,
        dealCompletedAt: typeof it.dealCompletedAt === "string" ? it.dealCompletedAt : "",
      };

      const newStatus = String(it.status ?? "").trim().toUpperCase();
      const newDaHoan = Number(it.daHoan) || 0;
      let newPhi: number | null = null;

      if (newStatus) {
        newPhi = await resolveRefundFeePctFromLine(agencyName, newStatus, anchorInput);
      }

      const doc = await upsertRefundLineStateDoc(it.billId, ky, {
        agencyName,
        status: newStatus,
        phiPct: newPhi,
        daHoan: newDaHoan,
      });

      if (doc) outStates.push(serializeRefundLineStateDoc(doc.toObject()));
    }

    return {
      data: {
        rulesInserted,
        lineStatesUpserted: outStates.length,
        lineStates: outStates,
      },
      source: "mongodb",
    };
  } catch (error) {
    throw new ServiceError(500, getErrorMessage(error, "Migrate không thành công"));
  }
}

export async function getAssignedCodes(query: Record<string, unknown>) {
  const agencyId = typeof query.agencyId === "string" ? query.agencyId.trim() : null;
  const customerCode = typeof query.customerCode === "string" ? query.customerCode.trim() : null;

  await ensureDb();

  try {
    const filter: Record<string, unknown> = {};
    if (agencyId) filter.agencyId = agencyId;
    if (customerCode) filter.customerCode = customerCode;

    const docs = await findAssignedCodesList(filter);
    return { data: docs, total: docs.length, source: "mongodb" };
  } catch (error) {
    throw new ServiceError(503, getErrorMessage(error, "Không đọc được MongoDB"), { data: [] });
  }
}

export async function assignAgency(body: {
  billId: string;
  agencyId: string;
  agencyName: string;
  actorUserId?: string;
}) {
  if (!body.billId || !body.agencyId || !body.agencyName) {
    throw new ServiceError(400, "Cần có billId, agencyId và agencyName");
  }

  if (!mongoose.isValidObjectId(body.billId)) {
    throw new ServiceError(400, "billId phải là _id MongoDB (ObjectId)");
  }

  const actorId = newObjectId(body.actorUserId);

  await ensureDb();

  const doc = await findElectricBillById(body.billId);
  if (!doc) {
    throw new ServiceError(404, "Không tìm thấy hóa đơn");
  }

  const dto = serializeElectricBill(doc.toObject());

  for (const p of dto.periods) {
    if (p.amount == null) continue;

    const conflict = await checkAssignedCodeConflict(
      doc.customerCode,
      p.amount,
      doc.year,
      doc.month,
      body.agencyId
    );

    if (conflict) {
      throw new ServiceError(
        409,
        `Mã "${doc.customerCode}" số tiền ${p.amount.toLocaleString("vi-VN")}đ tháng ${doc.month}/${doc.year} đã được giao cho đại lý "${conflict}". Không thể giao cho 2 đại lý khác nhau trong cùng tháng.`
      );
    }
  }

  const assignedAt = new Date();
  const nextPeriods = dto.periods.map((p) => {
    if (p.amount == null) return { ...p };
    return {
      ...p,
      assignedAgencyId: body.agencyId,
      assignedAgencyName: body.agencyName,
      dlGiaoName: p.dlGiaoName?.trim() ? p.dlGiaoName : body.agencyName,
    };
  });

  const updatedDoc = await assignElectricBillIfAvailable({
    billId: String(doc._id),
    agencyId: body.agencyId,
    agencyName: body.agencyName,
    assignedAt,
    periods: periodsDtoToMongoSchema(nextPeriods),
  });

  if (!updatedDoc) {
    throw new ServiceError(409, "Mã đã được giao bởi người khác. Vui lòng tải lại danh sách.");
  }

  for (const p of nextPeriods) {
    if (p.amount == null) continue;
    await upsertAssignedCodeDoc({
      customerCode: doc.customerCode,
      amount: p.amount,
      year: doc.year,
      month: doc.month,
      agencyId: body.agencyId,
      agencyName: body.agencyName,
      billId: String(doc._id),
      ky: p.ky,
    });
  }

  await writeAuditLog({
    actorUserId: actorId,
    action: "electric.assign_agency",
    entityType: "ElectricBillRecord",
    entityId: doc._id,
    metadata: {
      agencyId: body.agencyId,
      agencyName: body.agencyName,
      customerCode: doc.customerCode,
    },
  });

  return {
    data: serializeElectricBill(updatedDoc as Record<string, unknown>),
    source: "mongodb",
  };
}

export async function patchElectricBill(id: string, body: PatchBody) {
  if (!mongoose.isValidObjectId(id)) {
    throw new ServiceError(400, "id phải là _id MongoDB (ObjectId)");
  }

  const actorId = newObjectId(body.actorUserId);

  await ensureDb();

  try {
    const doc = await findElectricBillById(id);
    if (!doc) {
      throw new ServiceError(404, "Không tìm thấy bản ghi");
    }

    let nextPeriods = serializeElectricBill(doc.toObject()).periods;

    if (body.assignedAgencyId !== undefined && !body.periods?.length) {
      nextPeriods = nextPeriods.map((p) =>
        p.amount == null
          ? p
          : {
              ...p,
              assignedAgencyId: body.assignedAgencyId || null,
              assignedAgencyName: body.assignedAgencyName ?? p.assignedAgencyName,
            }
      );
    }

    if (body.periods?.length) {
      const actorRoles = Array.isArray(body.actorRoles)
        ? body.actorRoles
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().toUpperCase())
        : [];
      const isAdminActor = actorRoles.includes("ADMIN") || actorRoles.includes("SUPER_ADMIN");
      const billCustomerCode = doc.customerCode;
      const billYear = doc.year;
      const billMonth = doc.month;

      for (const patch of body.periods) {
        const cur = nextPeriods.find((p) => p.ky === patch.ky);
        const currentCompleted = Boolean(cur?.dealCompletedAt);
        const isEditingCompletedRow =
          currentCompleted &&
          (patch.scanDdMm !== undefined ||
            patch.ca !== undefined ||
            patch.assignedAgencyId !== undefined ||
            patch.assignedAgencyName !== undefined ||
            patch.dlGiaoName !== undefined ||
            patch.paymentConfirmed !== undefined ||
            patch.cccdConfirmed !== undefined ||
            patch.customerName !== undefined ||
            patch.cardType !== undefined);
        const isUnconfirmAction =
          currentCompleted &&
          patch.dealCompletedAt !== undefined &&
          (patch.dealCompletedAt === null || patch.dealCompletedAt === "");

        if ((isEditingCompletedRow || isUnconfirmAction) && !isAdminActor) {
          throw new ServiceError(403, "Chỉ ADMIN mới được sửa hoặc hủy xác nhận hóa đơn đã xác nhận.");
        }

        if (patch.amount !== undefined) {
          throw new ServiceError(400, "Không được phép chỉnh sửa SỐ TIỀN.");
        }

        if ((patch.assignedAgencyId === null || patch.assignedAgencyId === "") && cur?.amount != null) {
          await deleteAssignedCodeDoc(billCustomerCode, cur.amount, billYear, billMonth);
        }

        if (patch.assignedAgencyId && patch.assignedAgencyId.trim()) {
          const amount = patch.amount ?? cur?.amount;

          if (amount != null) {
            const conflict = await checkAssignedCodeConflict(
              billCustomerCode,
              amount,
              billYear,
              billMonth,
              patch.assignedAgencyId
            );

            if (conflict) {
              throw new ServiceError(
                409,
                `Mã "${billCustomerCode}" số tiền ${amount.toLocaleString("vi-VN")}đ tháng ${billMonth}/${billYear} đã được giao cho đại lý "${conflict}". Không thể giao cho 2 đại lý khác nhau trong cùng tháng.`
              );
            }
          }
        }

        if (patch.dealCompletedAt) {
          const trial = applyPeriodPatches(nextPeriods, [patch]);
          const row = trial.find((p) => p.ky === patch.ky);

          if (!row || !isPeriodReadyForDealCompletion({ ...row, dealCompletedAt: null })) {
            throw new ServiceError(
              400,
              "Chưa đủ dữ liệu kỳ này (Đại lý, Bill.TT, CCCD, Tên KH, ngày thanh toán dd/mm, CA 10h/16h/24h)."
            );
          }
        }
      }

      nextPeriods = applyPeriodPatches(nextPeriods, body.periods);

      for (const p of nextPeriods) {
        const raw = p.scanDdMm?.trim();
        if (raw && !scanDdMmIsNotFuture(raw)) {
          throw new ServiceError(
            400,
            "Ngày thanh toán (dd/mm) theo năm hiện tại không được sau hôm nay. Xóa và nhập lại ngày hợp lệ."
          );
        }
      }

      for (const patch of body.periods) {
        if (!patch.assignedAgencyId?.trim()) continue;

        const updated = nextPeriods.find((p) => p.ky === patch.ky);
        if (!updated?.amount || !updated.assignedAgencyName) continue;

        await upsertAssignedCodeDoc({
          customerCode: billCustomerCode,
          amount: updated.amount,
          year: billYear,
          month: billMonth,
          agencyId: patch.assignedAgencyId,
          agencyName: updated.assignedAgencyName,
          billId: id,
          ky: patch.ky,
        });
      }
    }

    if (body.assignedAgencyId !== undefined) {
      doc.set("assignedAgencyId", body.assignedAgencyId ?? undefined);
      if (!body.assignedAgencyId) {
        doc.set("assignedAgencyName", undefined);
        doc.set("assignedAt", undefined);
      }
    }

    if (body.assignedAgencyName !== undefined) {
      doc.set("assignedAgencyName", body.assignedAgencyName ?? undefined);
    }

    if (body.assignedAt !== undefined) {
      doc.set("assignedAt", body.assignedAt ? new Date(body.assignedAt) : undefined);
    }

    if (body.customerName !== undefined) doc.set("customerName", body.customerName ?? undefined);
    if (body.paymentConfirmed !== undefined) doc.set("paymentConfirmed", body.paymentConfirmed);
    if (body.cccdConfirmed !== undefined) doc.set("cccdConfirmed", body.cccdConfirmed);
    if (body.cardType !== undefined) doc.set("cardType", body.cardType ?? undefined);

    if (body.dealCompletedAt !== undefined && (body.dealCompletedAt === null || body.dealCompletedAt === "")) {
      doc.set("dealCompletedAt", undefined);
    }

    doc.set("periods", periodsDtoToMongoSchema(nextPeriods) as typeof doc.periods);
    syncBillLevelFromPeriods(doc, nextPeriods);
    doc.markModified("periods");

    await doc.save();

    const allPeriodsConfirmed = nextPeriods.every((p) => p.amount == null || Boolean(p.dealCompletedAt));
    if (allPeriodsConfirmed) {
      await markVoucherCodeCompleted(doc.customerCode);
    }

    await writeAuditLog({
      actorUserId: actorId,
      action: "electric.invoice_patch",
      entityType: "ElectricBillRecord",
      entityId: doc._id,
      metadata: {
        customerCode: doc.customerCode,
        patchedFields: Object.keys(body).filter((k) => k !== "actorUserId" && k !== "actorRoles"),
      },
    });

    return {
      data: serializeElectricBill(doc.toObject()),
      source: "mongodb",
    };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(500, getErrorMessage(error, "Cập nhật không thành công"));
  }
}