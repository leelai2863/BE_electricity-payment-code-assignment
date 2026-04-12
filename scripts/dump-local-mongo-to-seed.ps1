# Dumps local MongoDB DB giaodich_voucher into mongo-seed/dump/ for Docker init restore.
# Requires: Docker, local mongod on host reachable at host.docker.internal:27017
# Stop the compose "mongo" service first if port 27017 is bound by the container.

$ErrorActionPreference = "Stop"
# PSScriptRoot = .../backend/scripts → backend root
$backendRoot = Split-Path -Parent $PSScriptRoot

$dumpHost = (Join-Path $backendRoot "mongo-seed/dump")
New-Item -ItemType Directory -Force -Path $dumpHost | Out-Null

docker run --rm `
  -v "${dumpHost}:/backup" `
  mongo:7 `
  mongodump --uri="mongodb://host.docker.internal:27017/giaodich_voucher" --out=/backup

Write-Host "Done. Expect folder: $dumpHost/giaodich_voucher"
Write-Host "Then: docker compose down -v && docker compose up --build"
