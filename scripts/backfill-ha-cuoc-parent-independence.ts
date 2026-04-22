/**
 * Backfill dữ liệu cũ cho Hạ cước:
 * - Mã tổng (kỳ gốc) sau khi split đã resolved sẽ không còn gắn đại lý.
 * - Đồng bộ scanDdMm theo mã con chốt sau cùng (theo dealCompletedAt).
 * - Xóa AssignedCode của mã tổng để tránh kéo mapping đại lý sai.
 *
 * Chạy dry-run (không ghi DB):
 *   npx tsx scripts/backfill-ha-cuoc-parent-independence.ts
 *
 * Ghi DB:
 *   set MIGRATE_APPLY=true
 *   npx tsx scripts/backfill-ha-cuoc-parent-independence.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/mongodb";
import { SplitBillEntry } from "../src/models/SplitBillEntry";
import { ElectricBillRecord } from "../src/models/ElectricBillRecord";
import { serializeElectricBill } from "../src/lib/electric-bill-serialize";
import { periodsDtoToMongoSchema } from "../src/lib/electric-bill-mongo-periods";
import { deleteAssignedCodeDoc } from "../src/modules/electric-bills/electric-bills.repository";

const apply = String(process.env.MIGRATE_APPLY || "").trim().toLowerCase() === "true";

function toMs(raw: unknown): number {
  if (!raw) return Number.NaN;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  const t = d.getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

function pickLatestScanDdMm(
  split1: Record<string, unknown> | null | undefined,
  split2: Record<string, unknown> | null | undefined,
): string | null {
  const s1 = split1 ?? {};
  const s2 = split2 ?? {};
  const s1At = toMs(s1.dealCompletedAt);
  const s2At = toMs(s2.dealCompletedAt);
  const s1Scan = typeof s1.scanDdMm === "string" && s1.scanDdMm.trim() ? s1.scanDdMm.trim() : null;
  const s2Scan = typeof s2.scanDdMm === "string" && s2.scanDdMm.trim() ? s2.scanDdMm.trim() : null;
  if (Number.isFinite(s1At) && Number.isFinite(s2At)) return s2At >= s1At ? (s2Scan ?? s1Scan) : (s1Scan ?? s2Scan);
  if (Number.isFinite(s2At)) return s2Scan ?? s1Scan;
  if (Number.isFinite(s1At)) return s1Scan ?? s2Scan;
  return s2Scan ?? s1Scan;
}

async function run() {
  await connectDB();
  const splits = await SplitBillEntry.find({
    status: { $in: ["active", "resolved"] },
    createdBy: "thu-chi",
  })
    .select({
      originalBillId: 1,
      originalKy: 1,
      status: 1,
      split1: 1,
      split2: 1,
      customerCode: 1,
      month: 1,
      year: 1,
    })
    .lean();

  let scanned = 0;
  let wouldFix = 0;
  let saved = 0;
  let assignedDeleted = 0;
  let skippedNoBill = 0;
  let skippedNoPeriod = 0;

  for (const s of splits) {
    scanned += 1;
    const billId = String(s.originalBillId ?? "");
    const ky = Number(s.originalKy ?? 0);
    const splitStatus = String((s as { status?: unknown }).status ?? "active");
    const isResolved = splitStatus === "resolved";
    if (!billId || !(ky >= 1 && ky <= 3)) continue;

    const bill = await ElectricBillRecord.findById(billId).exec();
    if (!bill) {
      skippedNoBill += 1;
      continue;
    }

    const dto = serializeElectricBill(bill.toObject() as Record<string, unknown>);
    const idx = dto.periods.findIndex((p) => p.ky === ky);
    if (idx < 0) {
      skippedNoPeriod += 1;
      continue;
    }
    const p = dto.periods[idx]!;
    const latestScan = pickLatestScanDdMm(
      (s.split1 ?? null) as Record<string, unknown> | null,
      (s.split2 ?? null) as Record<string, unknown> | null,
    );

    const hasAgency = Boolean(p.assignedAgencyId || p.assignedAgencyName || p.dlGiaoName);
    const scanDrift = isResolved && Boolean(latestScan) && latestScan !== (p.scanDdMm ?? "");
    const confirmDrift = isResolved && (!Boolean(p.paymentConfirmed) || !Boolean(p.cccdConfirmed));
    const needFix = hasAgency || scanDrift || confirmDrift;
    if (!needFix) continue;

    wouldFix += 1;
    if (!apply) {
      console.info(
        `[dry-run] billId=${billId} customer=${dto.customerCode} ky=${ky} month=${dto.month}/${dto.year} ` +
          `status=${splitStatus} agency=${p.assignedAgencyName ?? "null"} -> null`,
      );
      continue;
    }

    const nextPeriods = dto.periods.map((x, i) => {
      if (i !== idx) return x;
      if (isResolved) {
        return {
          ...x,
          scanDdMm: latestScan ?? x.scanDdMm ?? null,
          assignedAgencyId: null,
          assignedAgencyName: null,
          dlGiaoName: null,
          paymentConfirmed: true,
          cccdConfirmed: true,
        };
      }
      // Active: mã tổng chưa được chốt — chỉ detach đại lý, giữ nguyên scan/confirm.
      return {
        ...x,
        assignedAgencyId: null,
        assignedAgencyName: null,
        dlGiaoName: null,
      };
    });
    bill.set("periods", periodsDtoToMongoSchema(nextPeriods) as typeof bill.periods);
    bill.markModified("periods");

    // Đồng bộ bill-level: nếu không còn period nào gán đại lý, xóa luôn agency ở bill.
    const anyPeriodHasAgency = nextPeriods.some(
      (x) => typeof x.assignedAgencyId === "string" && x.assignedAgencyId.trim()
    );
    if (!anyPeriodHasAgency) {
      bill.set("assignedAgencyId", undefined);
      bill.set("assignedAgencyName", undefined);
      bill.set("assignedAt", undefined);
    }

    await bill.save();
    saved += 1;

    if (p.amount != null && Number.isFinite(p.amount)) {
      await deleteAssignedCodeDoc(dto.customerCode, p.amount, dto.year, dto.month);
      assignedDeleted += 1;
    }
  }

  console.info(
    `[backfill-ha-cuoc-parent-independence] apply=${apply} scanned=${scanned} wouldFix=${wouldFix} ` +
      `saved=${saved} assignedDeleted=${assignedDeleted} skippedNoBill=${skippedNoBill} skippedNoPeriod=${skippedNoPeriod}`,
  );
}

run()
  .catch((e) => {
    console.error("[backfill-ha-cuoc-parent-independence] failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

