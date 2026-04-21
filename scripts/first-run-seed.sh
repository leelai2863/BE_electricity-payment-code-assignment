#!/usr/bin/env sh
# Chạy sau khi `docker compose up` đã healthy và container `giaodich-backend` đang chạy.
# Bắt buộc trên môi trường mới để có dữ liệu V-GREEN + VoucherCode tối thiểu.
set -e
docker exec giaodich-backend sh -c "cd /app && npx tsx scripts/seed-vgreen-electric-bills.ts && npx tsx scripts/seed-voucher-codes.ts"
echo "first-run-seed: done"
