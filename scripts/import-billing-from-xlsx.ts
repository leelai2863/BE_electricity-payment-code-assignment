/**
 * Đọc file Excel mã có cước → upsert vào collection electricbillrecords.
 *
 * Cấu trúc sheet (bỏ qua dòng header tự động):
 *   Cột A = mã khách hàng (customerCode)
 *   Cột B = số tiền VND  (amount — chấp nhận "15.892.913", "15,892,913" hoặc số thuần)
 *   Cột C = EVN (ví dụ EVNCPC, EVNHCMC...) — tuỳ chọn
 *   Cột D = hạn thanh toán (DD/MM — tuỳ chọn, ví dụ "06/04")
 *
 * Chạy từ thư mục backend:
 *   npm run seed:billing -- ./maHĐ.xlsx
 * hoặc:
 *   BILLING_XLSX_PATH=./maHĐ.xlsx npm run seed:billing
 */
import "dotenv/config";
import path from "node:path";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/mongodb";
import { ElectricBillRecord } from "../src/models/ElectricBillRecord";
import { mergeScanAmountIntoPeriods } from "../src/lib/period-scan-merge";
import type { ElectricBillPeriod } from "../src/types/electric-bill";

const YEAR = 2026;
const MONTH = 3;
const COMPANY = "V-GREEN";
const DEFAULT_EVN = "EVNCPC";
const SCAN_ISO = new Date().toISOString();

/** Parse số tiền từ chuỗi như "15.892.913", "15,892,913" hoặc số thuần */
function parseAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const str = String(raw).trim().replace(/\./g, "").replace(/,/g, "");
  const n = Number(str);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Parse hạn DD/MM → ISO string trong YEAR, hoặc null */
function parseDeadline(raw: unknown): string | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str.includes("/")) return null;
  const [dStr, mStr] = str.split("/");
  const d = Number(dStr);
  const m = Number(mStr);
  if (!Number.isFinite(d) || !Number.isFinite(m) || d < 1 || d > 31 || m < 1 || m > 12) return null;
  return new Date(YEAR, m - 1, d, 12, 0, 0, 0).toISOString();
}

/** Heuristic: dòng có cột A không phải mã thực (header) */
function looksLikeHeader(a: string, b: string): boolean {
  const al = a.toLowerCase();
  if (/^(stt|tt|#|mã|ma|code|kh|khách|ten|tên)/.test(al)) return true;
  if (/^(stt|tt|#|tiền|tien|amount|số|so)/.test(b.toLowerCase())) return true;
  return false;
}

type ColumnMap = {
  customerCode: number;
  amount: number;
  evn: number | null;
  deadline: number | null;
};

function detectColumns(ws: ExcelJS.Worksheet): ColumnMap {
  const r1 = ws.getRow(1);
  const headers = [1, 2, 3, 4, 5, 6].map((idx) =>
    String(r1.getCell(idx).text ?? r1.getCell(idx).value ?? "")
      .trim()
      .toLowerCase()
  );

  const findIdx = (patterns: RegExp[]): number | null => {
    const i = headers.findIndex((h) => patterns.some((p) => p.test(h)));
    return i >= 0 ? i + 1 : null;
  };

  const customerCode =
    findIdx([/(mã|ma).*(kh|khách|customer|code)/, /(customer).*(code)/, /^m(ã|a)\s*kh/i]) ?? 1;
  const amount = findIdx([/(số|so).*(tiền|tien)/, /amount/, /giá trị|gia tri/]) ?? 2;
  const evn = findIdx([/^evn$/, /điện lực|dien luc/]);
  const deadline = findIdx([/hạn.*thanh.*toán|han.*thanh.*toan/, /deadline/, /hạn|han/]);

  return { customerCode, amount, evn, deadline };
}

async function main() {
  const backendRoot = path.resolve(__dirname, "..");
  const rawPath = (process.argv[2] ?? process.env.BILLING_XLSX_PATH ?? "").trim();
  if (!rawPath) {
    throw new Error(
      "Thiếu đường dẫn file Excel.\n" +
        "  Dùng: npm run seed:billing -- ./maHĐ.xlsx\n" +
        "  Hoặc: BILLING_XLSX_PATH=./maHĐ.xlsx npm run seed:billing"
    );
  }

  const absolute = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(backendRoot, rawPath);
  console.log(`Đọc file: ${absolute}`);

  await connectDB();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(absolute);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("File không có sheet nào.");

  const cols = detectColumns(ws);

  // Xác định dòng bắt đầu (bỏ qua header nếu có)
  let startRow = 1;
  const r1 = ws.getRow(1);
  const a1 = String(r1.getCell(cols.customerCode).text ?? r1.getCell(cols.customerCode).value ?? "").trim();
  const b1 = String(r1.getCell(cols.amount).text ?? r1.getCell(cols.amount).value ?? "").trim();
  if (looksLikeHeader(a1, b1)) startRow = 2;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (let rowIdx = startRow; rowIdx <= ws.rowCount; rowIdx++) {
    const row = ws.getRow(rowIdx);
    const rawA = row.getCell(cols.customerCode).text ?? row.getCell(cols.customerCode).value;
    const rawB = row.getCell(cols.amount).text ?? row.getCell(cols.amount).value;
    const rawEvn = cols.evn ? row.getCell(cols.evn).text ?? row.getCell(cols.evn).value : null;
    const rawDeadline = cols.deadline ? row.getCell(cols.deadline).text ?? row.getCell(cols.deadline).value : null;

    const customerCode = String(rawA ?? "").trim();
    const amount = parseAmount(rawB);
    const deadlineIso = parseDeadline(rawDeadline);
    const evn = String(rawEvn ?? "").trim() || DEFAULT_EVN;

    if (!customerCode || amount === null) {
      skipped++;
      continue;
    }

    const existing = await ElectricBillRecord.findOne({
      customerCode,
      year: YEAR,
      month: MONTH,
    }).lean();

    const newPeriods = mergeScanAmountIntoPeriods(
      existing?.periods as ElectricBillPeriod[] | undefined,
      { amount, deadlineIso, scanIso: SCAN_ISO }
    );

    if (existing) {
      await ElectricBillRecord.updateOne(
        { _id: existing._id },
        { $set: { periods: newPeriods, evn } }
      );
      updated++;
    } else {
      await ElectricBillRecord.create({
        customerCode,
        year: YEAR,
        month: MONTH,
        monthLabel: `T${MONTH}/${YEAR}`,
        company: COMPANY,
        evn,
        periods: newPeriods,
      });
      created++;
    }

    const deadline = deadlineIso ? String(rawDeadline ?? "").trim() : "—";
    console.log(
      `  [${existing ? "UPD" : "NEW"}] ${customerCode}  ${amount.toLocaleString("vi-VN")} đ  EVN: ${evn}  hạn: ${deadline}`
    );
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
