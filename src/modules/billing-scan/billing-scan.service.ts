import { BillingScanRepository } from "./billing-scan.repository";
import { serializeHistory, serializeElectricBill, billHasIncompletePeriod } from "@/lib/electric-bill-serialize";
import type { ElectricBillDto } from "@/types/electric-bill";

export const BillingScanService = {
  async getHistory() {
    const rows = await BillingScanRepository.findHistory();
    return rows.map((r) => serializeHistory(r as Record<string, unknown>));
  },

  async getScannedCodes() {
    const docs = await BillingScanRepository.findIncompleteVGreenBills();
    
    return (docs as unknown as Record<string, unknown>[])
      .map((d) => serializeElectricBill(d))
      .filter(billHasIncompletePeriod)
      .sort((a: ElectricBillDto, b: ElectricBillDto) => 
        a.customerCode.localeCompare(b.customerCode)
      );
  }
};