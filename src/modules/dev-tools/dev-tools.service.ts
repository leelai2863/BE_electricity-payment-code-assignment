import { connectDB } from "@/lib/mongodb";
import { Agency } from "@/models/Agency";
import { AssignedCode } from "@/models/AssignedCode";
import { AuditLog } from "@/models/AuditLog";
import { BillingScanHistory } from "@/models/BillingScanHistory";
import { BillingScanJob } from "@/models/BillingScanJob";
import { ChargesStagingRow } from "@/models/ChargesStagingRow";
import { CheckbillIngestBatch } from "@/models/CheckbillIngestBatch";
import { CustomerAccount } from "@/models/CustomerAccount";
import { ElectricBillRecord } from "@/models/ElectricBillRecord";
import { RefundFeeRule } from "@/models/RefundFeeRule";
import { RefundLineState } from "@/models/RefundLineState";
import { VoucherCode } from "@/models/VoucherCode";

type DeleteResult = { deletedCount?: number };

export async function purgeMockData() {
  await connectDB();

  const tasks: Array<[string, Promise<DeleteResult>]> = [
    ["agencies", Agency.deleteMany({})],
    ["customerAccounts", CustomerAccount.deleteMany({})],
    ["voucherCodes", VoucherCode.deleteMany({})],
    ["assignedCodes", AssignedCode.deleteMany({})],
    ["electricBillRecords", ElectricBillRecord.deleteMany({})],
    ["refundFeeRules", RefundFeeRule.deleteMany({})],
    ["refundLineStates", RefundLineState.deleteMany({})],
    ["billingScanJobs", BillingScanJob.deleteMany({})],
    ["billingScanHistory", BillingScanHistory.deleteMany({})],
    ["checkbillIngestBatches", CheckbillIngestBatch.deleteMany({})],
    ["chargesStagingRows", ChargesStagingRow.deleteMany({})],
    ["auditLogs", AuditLog.deleteMany({})],
  ];

  const summary: Record<string, number> = {};
  for (const [name, task] of tasks) {
    const out = await task;
    summary[name] = Number(out.deletedCount ?? 0);
  }

  return summary;
}

