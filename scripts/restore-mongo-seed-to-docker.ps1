# Restores mongo-seed/dump into Docker Mongo via published host port (see MONGO_HOST_PORT in docker-compose / .env).
# Requires: folder backend/mongo-seed/dump/giaodich_voucher/ from mongodump
# Uses --drop: replaces collections in DBs present in the dump.

$ErrorActionPreference = "Stop"
$mongoHostPort = if ($env:MONGO_HOST_PORT) { $env:MONGO_HOST_PORT } else { "27018" }
$backendRoot = Split-Path -Parent $PSScriptRoot
$dumpHost = Join-Path $backendRoot "mongo-seed/dump"
$marker = Join-Path $dumpHost "giaodich_voucher"
if (-not (Test-Path $marker)) {
  Write-Error "Chưa có dump: cần thư mục $marker (chạy npm run docker:dump-mongo-seed khi Mongo trên máy còn dữ liệu, hoặc copy bản dump vào đó)."
}

docker run --rm `
  -v "${dumpHost}:/dump:ro" `
  mongo:7 `
  mongorestore --uri="mongodb://host.docker.internal:${mongoHostPort}" --dir=/dump --drop

Write-Host "Xong. Compass: mongodb://localhost:${mongoHostPort} → giaodich_voucher (hoặc docker exec giaodich-mongo mongosh …)"
