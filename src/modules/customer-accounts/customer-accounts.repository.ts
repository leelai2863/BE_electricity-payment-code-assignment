import { connectDB } from "@/lib/mongodb";
import { CustomerAccount } from "@/models/CustomerAccount";

export const CustomerAccountRepository = {
  async findWithPagination(filter: any, skip: number, limit: number) {
    await connectDB();
    return await CustomerAccount.find(filter)
      .sort({ customerCode: 1 })
      .skip(skip)
      .limit(limit)
      .lean();
  },

  async count(filter: any) {
    await connectDB();
    return await CustomerAccount.countDocuments(filter);
  },

  async bulkUpsert(ops: any[]) {
    await connectDB();
    return await CustomerAccount.bulkWrite(ops, { ordered: false });
  },

  async deleteById(id: string) {
    await connectDB();
    return await CustomerAccount.findByIdAndDelete(id);
  },

  async updateById(id: string, updateData: any) {
    await connectDB();
    return await CustomerAccount.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).lean();
  }
};