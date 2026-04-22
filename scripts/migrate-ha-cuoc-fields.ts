/**
 * Một lần: nguồn hệ thống Hạ Cước + bổ sung field split (legacy).
 * Chạy: npx tsx scripts/migrate-ha-cuoc-fields.ts
 */
import "dotenv/config";
import { connectDB } from "../src/lib/mongodb";
import { SplitBillEntry } from "../src/models/SplitBillEntry";
import { upsertHaCuocSystemSource } from "../src/modules/accounting-thu-chi/user-source-preference.repository";

async function main() {
  await connectDB();
  await SplitBillEntry.updateMany({ createdBy: { $exists: false } }, { $set: { createdBy: "manual" } });
  await SplitBillEntry.updateMany({ sourceThuChiId: { $exists: false } }, { $set: { sourceThuChiId: null } });
  await SplitBillEntry.updateMany({ lockedByThuChi: { $exists: false } }, { $set: { lockedByThuChi: false } });
  await upsertHaCuocSystemSource();
  console.info("migrate-ha-cuoc-fields: done");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
