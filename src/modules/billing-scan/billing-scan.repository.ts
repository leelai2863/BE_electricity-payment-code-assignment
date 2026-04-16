import { connectDB } from "@/lib/mongodb";
import { BillingScanHistory } from "@/models/BillingScanHistory";
import { ChargesStagingRow } from "@/models/ChargesStagingRow";

export const BillingScanRepository = {
  async findHistory(limit = 500) {
    await connectDB();
    return await BillingScanHistory.find()
      .sort({ scannedAt: -1 })
      .limit(limit)
      .lean();
  },

  async findChargesStagingPending(limit = 10_000) {
    await connectDB();
    return await ChargesStagingRow.find()
      .sort({ receivedAt: -1 })
      .limit(limit)
      .lean();
  },

  async findChargesStagingById(id: string) {
    await connectDB();
    return await ChargesStagingRow.findById(id).lean();
  },

  async deleteChargesStagingById(id: string) {
    await connectDB();
    return await ChargesStagingRow.deleteOne({ _id: id });
  },
};
