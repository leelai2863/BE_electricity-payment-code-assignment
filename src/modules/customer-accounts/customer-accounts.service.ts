import { CustomerAccountRepository } from "./customer-accounts.repository";

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

  async importRows(rows: any[]) {
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
    return {
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
      totalCount: ops.length,
    };
  },

  async deleteAccount(id: string) {
    return await CustomerAccountRepository.deleteById(id);
  },

  async updateAccount(id: string, body: any) {
    const { active, note, evnPass } = body;
    const update: Record<string, any> = {};
    if (active !== undefined) update.active = active;
    if (note !== undefined) update.note = note;
    if (evnPass !== undefined) update.evnPass = evnPass;
    
    return await CustomerAccountRepository.updateById(id, update);
  }
};