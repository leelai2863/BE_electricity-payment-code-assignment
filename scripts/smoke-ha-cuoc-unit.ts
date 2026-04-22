/** Kiểm tra nhanh helper Hạ Cước (không cần Mongo). npm run test:ha-cuoc */
import assert from "node:assert/strict";
import {
  formatAnchorDdMmHoChiMinh,
  isHaCuocSource,
  parseCustomerCodeFromDescription,
  vnCalendarYearMonth,
} from "../src/modules/accounting-thu-chi/ha-cuoc.service";

assert.equal(isHaCuocSource("Hạ Cước"), true);
assert.equal(isHaCuocSource("  hạ   cước  "), true);
assert.equal(isHaCuocSource("Đại lý A"), false);
assert.equal(parseCustomerCodeFromDescription("  pc05ii0947012  "), "PC05II0947012");
assert.equal(parseCustomerCodeFromDescription("bad"), null);
assert.equal(parseCustomerCodeFromDescription("ABCDEFGHIJ"), "ABCDEFGHIJ"); // 10 chars min
assert.equal(
  parseCustomerCodeFromDescription("ABCDEFGHIJKLMNOP"), // 16 max
  "ABCDEFGHIJKLMNOP",
);
assert.equal(parseCustomerCodeFromDescription("ABCDEFGHI"), null); // 9 chars
assert.equal(parseCustomerCodeFromDescription("ABCDEFGHIJKLMNOPQ"), null); // 17 chars

const d = new Date("2026-04-30T17:00:00.000Z");
const ym = vnCalendarYearMonth(d);
assert.equal(ym.month, 5);
assert.equal(ym.year, 2026);

// 30/04 23:30 UTC = 01/05 06:30 VN → tháng 5
const mayAnchor = new Date("2026-04-30T23:30:00.000Z");
assert.deepEqual(vnCalendarYearMonth(mayAnchor), { year: 2026, month: 5 });
assert.equal(formatAnchorDdMmHoChiMinh(mayAnchor), "01/05");

// Giữa trưa VN cùng ngày lịch
const noonVn = new Date("2026-05-15T05:00:00.000Z");
assert.deepEqual(vnCalendarYearMonth(noonVn), { year: 2026, month: 5 });
assert.equal(formatAnchorDdMmHoChiMinh(noonVn), "15/05");

console.info("smoke-ha-cuoc-unit: ok");
