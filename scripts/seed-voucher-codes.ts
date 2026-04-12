/**
 * Seed collection `vouchercodes` — mã khách hàng (mã có cước) để test luồng voucher.
 *
 * Chạy từ thư mục backend (cần MONGODB_URI trong .env):
 *   npm run seed:vouchers
 *
 * Mặc định: upsert từng mã trong VGREEN_SCANNED_BATCH với status=1 (đã quét, có bill).
 * Nếu đã chạy `npm run seed:vgreen`, trường `code` trùng `customerCode` của hóa đơn điện.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/mongodb";
import { VoucherCode } from "../src/models/VoucherCode";
import { VGREEN_SCANNED_BATCH } from "./data/vgreen-scanned-batch";

async function main() {
  await connectDB();
  let upserted = 0;
  for (const row of VGREEN_SCANNED_BATCH) {
    await VoucherCode.findOneAndUpdate(
      { code: row.customerCode },
      {
        $set: {
          status: 1,
          billingScanHasBill: true,
          billingScanMeta: { seededFrom: "seed-voucher-codes", amount: row.amount },
        },
      },
      { upsert: true }
    );
    upserted++;
  }
  console.log(`Done. Upserted ${upserted} voucher code(s) from VGREEN_SCANNED_BATCH.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
