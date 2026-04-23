import { CustomerAccountRepository } from "./customer-accounts.repository";
import mongoose from "mongoose";
import { writeAuditLog } from "@/lib/audit";
import { ELEC_SYSTEM_AUDIT_ACTOR_ID } from "@/lib/elec-crm-audit";

type AuditCtx = {
  actorUserId?: string;
  ip?: string | null;
  userAgent?: string | null;
  actorEmail?: string | null;
  actorDisplayName?: string | null;
};

function resolveActorId(raw?: string): mongoose.Types.ObjectId {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s && mongoose.isValidObjectId(s)) return new mongoose.Types.ObjectId(s);
  return new mongoose.Types.ObjectId(ELEC_SYSTEM_AUDIT_ACTOR_ID);
}

export const CustomerAccountService = {
  async getList(search: string, page: number, limit: number) {
    const filter: Record<string, any> = {};
    if (search) {
      const re = new RegExp(search, "i");
      filter.$or = [
        { customerCode: re }, { companyName: re },
        { stationCode: re }, { evnUser: re }, { evnRegion: re },
      ];
    }

    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      CustomerAccountRepository.findWithPagination(filter, skip, limit),
      CustomerAccountRepository.count(filter),
    ]);

    const mappedData = docs.map((d: any) => ({
      _id: String(d._id),
      customerCode: d.customerCode,
      companyName: d.companyName ?? null,
      stationCode: d.stationCode ?? null,
      evnUser: d.evnUser ?? null,
      evnPass: d.evnPass ?? null,
      evnRegion: d.evnRegion ?? null,
      active: d.active,
      note: d.note ?? null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return { data: mappedData, total };
  },

  async importRows(rows: any[], ctx?: AuditCtx) {
    const ops = rows
      .map((r) => {
        const code = typeof r.customerCode === "string" ? r.customerCode.trim() : "";
        if (!code) return null;
        return {
          updateOne: {
            filter: { customerCode: code },
            update: {
              $set: {
                customerCode: code,
                companyName: r.companyName?.trim() ?? null,
                stationCode: r.stationCode?.trim() ?? null,
                evnUser: r.evnUser?.trim() ?? null,
                evnPass: r.evnPass ?? null,
                evnRegion: r.evnRegion?.trim() ?? null,
              },
              $setOnInsert: { active: true },
            },
            upsert: true,
          },
        };
      })
      .filter(Boolean);

    const result = await CustomerAccountRepository.bulkUpsert(ops);
    await writeAuditLog({
      actorUserId: resolveActorId(ctx?.actorUserId),
      action: "customer_account.import",
      entityType: "CustomerAccountImport",
      entityId: new mongoose.Types.ObjectId(),
      metadata: {
        inserted: result.upsertedCount,
        updated: result.modifiedCount,
        totalCount: ops.length,
      },
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      actorEmail: ctx?.actorEmail,
      actorDisplayName: ctx?.actorDisplayName,
    });
    return {
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
      totalCount: ops.length,
    };
  },

  async deleteAccount(id: string, ctx?: AuditCtx) {
    const deleted = await CustomerAccountRepository.deleteById(id);
    if (deleted) {
      await writeAuditLog({
        actorUserId: resolveActorId(ctx?.actorUserId),
        action: "customer_account.delete",
        entityType: "CustomerAccount",
        entityId: deleted._id,
        metadata: {
          accountId: String(deleted._id),
          customerCode: deleted.customerCode ?? null,
          companyName: deleted.companyName ?? null,
          stationCode: deleted.stationCode ?? null,
        },
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        actorEmail: ctx?.actorEmail,
        actorDisplayName: ctx?.actorDisplayName,
      });
    }
    return deleted;
  },

  async updateAccount(id: string, body: any, ctx?: AuditCtx) {
    const { active, note, evnPass } = body;
    const update: Record<string, any> = {};
    if (active !== undefined) update.active = active;
    if (note !== undefined) update.note = note;
    if (evnPass !== undefined) update.evnPass = evnPass;

    const doc = await CustomerAccountRepository.updateById(id, update);
    if (doc) {
      await writeAuditLog({
        actorUserId: resolveActorId(ctx?.actorUserId),
        action: "customer_account.update",
        entityType: "CustomerAccount",
        entityId: new mongoose.Types.ObjectId(String(doc._id)),
        metadata: {
          accountId: String(doc._id),
          customerCode: doc.customerCode ?? null,
          changedFields: Object.keys(update),
          active: doc.active,
          note: doc.note ?? null,
          evnPassChanged: evnPass !== undefined,
        },
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        actorEmail: ctx?.actorEmail,
        actorDisplayName: ctx?.actorDisplayName,
      });
    }
    return doc;
  }
};