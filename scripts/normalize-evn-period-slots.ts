/**
 * Gom tiền + meta quét sang đúng kỳ đã có hạn EVN (ok) trên Mongo — sửa bản ghi lệch cũ
 * (tiền ở k1, hạn ở k2) mà không cần gọi lại AutoCheck.
 *
 * Chạy (chỉ in, không ghi DB):
 *   npx tsx scripts/normalize-evn-period-slots.ts
 *
 * Ghi DB (cần xác nhận rõ):
 *   set MIGRATE_APPLY=true
 *   npx tsx scripts/normalize-evn-period-slots.ts
 *
 * Cần MONGODB_URI trong .env (cùng service elec).
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/mongodb";
import { ElectricBillRecord } from "../src/models/ElectricBillRecord";
import { serializeElectricBill } from "../src/lib/electric-bill-serialize";
import { repairSplitBillAmountIntoEvnTruthKySlot } from "../src/modules/electric-bills/payment-deadline-sync.service";
import { periodsDtoToMongoSchema } from "../src/lib/electric-bill-mongo-periods";

const apply = String(process.env.MIGRATE_APPLY || "").trim().toLowerCase() === "true";

async function run() {
  await connectDB();

  const q = {
    periods: {
      $elemMatch: {
        evnPaymentDeadlineSyncStatus: "ok",
        paymentDeadline: { $ne: null },
        $or: [{ amount: null }, { amount: { $exists: false } }],
      },
    },
  } as const;

  const cursor = ElectricBillRecord.find(q).cursor();
  let scanned = 0;
  let wouldFix = 0;
  let saved = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const dto = serializeElectricBill(doc.toObject() as Record<string, unknown>);
    const { next, changed } = repairSplitBillAmountIntoEvnTruthKySlot(dto.periods);
    if (!changed) continue;
    wouldFix += 1;
    if (apply) {
      doc.set("periods", periodsDtoToMongoSchema(next) as typeof doc.periods);
      doc.markModified("periods");
      await doc.save();
      saved += 1;
    } else {
      console.info(
        `[dry-run] would fix billId=${String(doc._id)} customerCode=${dto.customerCode} month=${dto.month}/${dto.year}`,
      );
    }
  }

  console.info(
    `[normalize-evn-period-slots] apply=${apply} scanned=${scanned} wouldFix=${wouldFix} saved=${saved}`,
  );
}

run()
  .catch((e) => {
    console.error("[normalize-evn-period-slots] failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
