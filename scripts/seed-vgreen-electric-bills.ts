/**
 * Seed script: upsert V-GREEN tháng 3/2026 vào ElectricBillRecord.
 * Chạy: npm run seed:vgreen  (từ thư mục backend)
 *
 * Logic:
 *   - Với mỗi dòng trong VGREEN_SCANNED_BATCH, upsert document { customerCode, year:2026, month:3 }
 *   - Dùng mergeScanAmountIntoPeriods để điền amount + paymentDeadline vào kỳ còn trống
 *   - Nếu document chưa tồn tại → tạo mới với company:"V-GREEN", evn:"EVNCPC"
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/mongodb";
import { ElectricBillRecord } from "../src/models/ElectricBillRecord";
import {
  VGREEN_SCANNED_BATCH,
  deadlineIsoFromDdMm,
} from "./data/vgreen-scanned-batch";
import { mergeScanAmountIntoPeriods } from "../src/lib/period-scan-merge";
import type { ElectricBillPeriod } from "../src/types/electric-bill";

const YEAR = 2026;
const MONTH = 3;
const SCAN_ISO = new Date().toISOString();

async function main() {
  await connectDB();
  console.log(`Seeding ${VGREEN_SCANNED_BATCH.length} V-GREEN records (T${MONTH}/${YEAR})…`);

  let created = 0;
  let updated = 0;

  for (const row of VGREEN_SCANNED_BATCH) {
    const deadlineIso = deadlineIsoFromDdMm(row.deadlineDdMm);

    const existing = await ElectricBillRecord.findOne({
      customerCode: row.customerCode,
      year: YEAR,
      month: MONTH,
    }).lean();

    const newPeriods = mergeScanAmountIntoPeriods(
      existing?.periods as ElectricBillPeriod[] | undefined,
      { amount: row.amount, deadlineIso, scanIso: SCAN_ISO }
    );

    if (existing) {
      await ElectricBillRecord.updateOne(
        { _id: existing._id },
        { $set: { periods: newPeriods } }
      );
      updated++;
    } else {
      await ElectricBillRecord.create({
        customerCode: row.customerCode,
        year: YEAR,
        month: MONTH,
        monthLabel: `T${MONTH}/${YEAR}`,
        company: "V-GREEN",
        evn: "EVNCPC",
        periods: newPeriods,
      });
      created++;
    }

    console.log(
      `  [${existing ? "UPD" : "NEW"}] ${row.customerCode}  ${row.amount.toLocaleString("vi-VN")} đ  deadline: ${row.deadlineDdMm ?? "—"}`
    );
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
