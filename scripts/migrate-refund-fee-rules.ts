import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/mongodb";
import { RefundFeeRule } from "../src/models/RefundFeeRule";

async function run() {
  await connectDB();
  const cursor = RefundFeeRule.find({}).cursor();
  let migrated = 0;
  for await (const doc of cursor) {
    let changed = false;
    if (doc.feeName === undefined) {
      doc.set("feeName", doc.statusLabel ?? "");
      changed = true;
    }
    if (!doc.conditionType) {
      doc.set("conditionType", "manual");
      changed = true;
    }
    if (doc.amountMin === undefined) {
      doc.set("amountMin", null);
      changed = true;
    }
    if (doc.amountMax === undefined) {
      doc.set("amountMax", null);
      changed = true;
    }
    if (doc.cardType === undefined) {
      doc.set("cardType", null);
      changed = true;
    }
    if (doc.effectiveTo === undefined) {
      doc.set("effectiveTo", null);
      changed = true;
    }
    if (doc.isActive === undefined) {
      doc.set("isActive", true);
      changed = true;
    }
    if (changed) {
      await doc.save();
      migrated += 1;
    }
  }
  console.info(`[migrate-refund-fee-rules] migrated=${migrated}`);
}

run()
  .catch((error) => {
    console.error("[migrate-refund-fee-rules] failed", error);
    const runtime = globalThis as typeof globalThis & { process?: { exitCode?: number } };
    if (runtime.process) runtime.process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

