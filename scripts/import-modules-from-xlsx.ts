/**
 * Đọc Excel (sheet đầu): cột A = tên module, cột B = mã (vd 1.0.0, 2.1.1), upsert vào MongoDB collection systemmodules.
 *
 * Chạy từ thư mục backend (cần MONGODB_URI trong .env):
 *   npm run seed:modules -- "D:\\path\\to\\danh-muc.xlsx"
 * hoặc:
 *   MODULES_XLSX_PATH=D:\\path\\to\\file.xlsx npm run seed:modules
 *
 * Bỏ qua dòng trống; dòng có tên nhưng không có mã sẽ bị bỏ qua (cần cả hai cột).
 */
import "dotenv/config";
import path from "node:path";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { connectDB } from "../src/lib/mongodb";
import { SystemModule } from "../src/models/SystemModule";

function parentFromCode(code: string): string | null {
  const parts = code.trim().split(".").filter(Boolean);
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

function looksLikeHeaderRow(name: string, code: string): boolean {
  const n = name.toLowerCase();
  const c = code.toLowerCase();
  if (/^(stt|tt|#)/.test(c)) return true;
  if (n.includes("tên") && (c.includes("mã") || c === "")) return true;
  if (n.includes("mô tả") && c.includes("mã")) return true;
  return false;
}

function looksLikeCodeCell(code: string): boolean {
  const t = code.trim();
  if (!t) return false;
  return /^[\d.]+$/.test(t) || /^[\w.-]+$/i.test(t);
}

async function main() {
  const filePath =
    process.argv[2] ||
    process.env.MODULES_XLSX_PATH ||
    (() => {
      throw new Error(
        "Thiếu đường dẫn file. Dùng: npm run seed:modules -- \"C:\\\\path\\\\file.xlsx\" hoặc MODULES_XLSX_PATH=..."
      );
    })();

  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  await connectDB();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(absolute);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error("File không có sheet nào.");
  }

  let startRow = 1;
  const first = ws.getRow(1);
  const cellA1 = first.getCell(1);
  const cellB1 = first.getCell(2);
  const n1 = String(cellA1.text ?? cellA1.value ?? "").trim();
  const c1 = String(cellB1.text ?? cellB1.value ?? "").trim();
  if (looksLikeHeaderRow(n1, c1) || (n1 && !looksLikeCodeCell(c1) && c1 === "")) {
    startRow = 2;
  }

  let upserted = 0;
  let skipped = 0;

  for (let r = startRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const c1 = row.getCell(1);
    const c2 = row.getCell(2);
    const name = String(c1.text ?? c1.value ?? "").trim();
    const code = String(c2.text ?? c2.value ?? "").trim();

    if (!name && !code) {
      skipped++;
      continue;
    }
    if (!code) {
      skipped++;
      continue;
    }

    const parentCode = parentFromCode(code);
    await SystemModule.findOneAndUpdate(
      { code },
      { $set: { name: name || code, parentCode, rowIndex: r } },
      { upsert: true, new: true }
    );
    upserted++;
  }

  console.log(`Done. Upserted ${upserted} row(s), skipped ${skipped} empty/invalid row(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
