Mục đích: đưa bản sao DB trên máy vào Mongo trong Docker.

Cổng Mongo Docker trên máy (Compass, restore): mặc định 27018 — xem MONGO_HOST_PORT trong docker-compose / .env.
Mongo cài sẵn trên Windows thường dùng 27017; tách cổng để không nhầm.

Bước 1 — Xuất dữ liệu từ Mongo trên máy (mongodump, DB đang chạy ngoài Docker)
  - Tắt service mongo trong docker-compose (để không tranh cổng nếu bạn dump qua host).
  - Mongo trên máy mặc định ở 27017. Từ thư mục backend (PowerShell):

    docker run --rm -v "${PWD}/mongo-seed/dump:/backup" mongo:7 mongodump --uri="mongodb://host.docker.internal:27017/giaodich_voucher" --out=/backup

  - Nếu Mongo trên máy của bạn dùng cổng khác, sửa số cổng trong URI cho đúng.
  - Sau lệnh này phải có: mongo-seed/dump/giaodich_voucher/ (file .bson, .json).

Bước 2 — Import lần đầu vào volume Docker
  - Script 01-restore-giaodich.sh chỉ chạy khi volume dữ liệu Mongo TRỐNG.
  - Nếu cần chạy lại init: docker compose down -v && docker compose up --build

Bước 3 — Giữ dữ liệu
  - Tránh "docker compose down -v" nếu không muốn xóa volume mongo_data.

Cách 2 — Import khi stack Docker đang chạy
  - Cần mongo-seed/dump/giaodich_voucher/
  - Bật docker compose (Mongo publish đúng MONGO_HOST_PORT, mặc định 27018).
  - npm run docker:restore-mongo-seed  (script dùng host.docker.internal + cổng đó)

Compass → Mongo Docker: mongodb://localhost:27018 (hoặc cổng bạn đặt trong MONGO_HOST_PORT).
