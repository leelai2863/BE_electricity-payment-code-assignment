//xu ly logic nghiep vu lien quan den agency o day
//nhan du lieu tho, kiem tra dieu kien, goi repository tuong ung, tra ve ket qua
import { 
  createAgency, 
  deleteAgency, 
  listAgencyOptions, 
  updateAgencyName 
} from "@/lib/agency-repository";
import { agenciesAsTreeRoots } from "@/lib/agency-registry";
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

export const AgenciesService = {
  async getAllAgencies() {
    return await listAgencyOptions();
  },

  async getAgencyTree() {
    const opts = await listAgencyOptions();
    return agenciesAsTreeRoots(opts);
  },

  async createNewAgency(payload: { name: string; code?: string }, ctx?: AuditCtx) {
    // Bạn có thể thêm logic kiểm tra nghiệp vụ phức tạp ở đây
    const created = await createAgency(payload);
    await writeAuditLog({
      actorUserId: resolveActorId(ctx?.actorUserId),
      action: "agency.create",
      entityType: "Agency",
      entityId: new mongoose.Types.ObjectId(created.id),
      metadata: {
        agencyId: created.id,
        name: created.name,
        code: created.code,
      },
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      actorEmail: ctx?.actorEmail,
      actorDisplayName: ctx?.actorDisplayName,
    });
    return created;
  },

  async updateName(id: string, name: string, ctx?: AuditCtx) {
    const beforeList = await listAgencyOptions();
    const before = beforeList.find((x) => x.id === id) ?? null;
    const updated = await updateAgencyName({ id, name });
    await writeAuditLog({
      actorUserId: resolveActorId(ctx?.actorUserId),
      action: "agency.update",
      entityType: "Agency",
      entityId: new mongoose.Types.ObjectId(updated.id),
      metadata: {
        agencyId: updated.id,
        nameBefore: before?.name ?? null,
        nameAfter: updated.name,
        code: updated.code,
      },
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      actorEmail: ctx?.actorEmail,
      actorDisplayName: ctx?.actorDisplayName,
    });
    return updated;
  },

  async removeAgency(id: string, ctx?: AuditCtx) {
    const beforeList = await listAgencyOptions();
    const before = beforeList.find((x) => x.id === id) ?? null;
    await deleteAgency(id);
    await writeAuditLog({
      actorUserId: resolveActorId(ctx?.actorUserId),
      action: "agency.delete",
      entityType: "Agency",
      entityId: new mongoose.Types.ObjectId(id),
      metadata: {
        agencyId: id,
        name: before?.name ?? null,
        code: before?.code ?? null,
        deletedSoft: true,
      },
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      actorEmail: ctx?.actorEmail,
      actorDisplayName: ctx?.actorDisplayName,
    });
  }
};