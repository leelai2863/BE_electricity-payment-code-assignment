import { connectDB } from "@/lib/mongodb";
import { BillingScanHistory } from "@/models/BillingScanHistory";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";

export const BillingScanRepository = {
  async findHistory(limit = 500) {
    await connectDB();
    return await BillingScanHistory.find()
      .sort({ scannedAt: -1 })
      .limit(limit)
      .lean();
  },

  async findIncompleteVGreenBills() {
    await connectDB();
    return await ElectricBillRecord.find({
      company: "V-GREEN",
      $or: [{ dealCompletedAt: null }, { dealCompletedAt: { $exists: false } }],
    }).lean();
  }
};