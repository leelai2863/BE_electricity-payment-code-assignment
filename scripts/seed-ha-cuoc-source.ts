/** Chạy: npx tsx scripts/seed-ha-cuoc-source.ts */
import "dotenv/config";
import { connectDB } from "../src/lib/mongodb";
import { upsertHaCuocSystemSource } from "../src/modules/accounting-thu-chi/user-source-preference.repository";

async function main() {
  await connectDB();
  await upsertHaCuocSystemSource();
  console.info("seed-ha-cuoc-source: ok");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
