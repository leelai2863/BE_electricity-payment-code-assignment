# Restore BSON dump thư mục (README mục 11): mongo-seed/dump/giaodich_voucher/
# Yêu cầu: Mongo Docker đang chạy (giaodich-mongo), cổng host mặc định 27018.
# Cài MongoDB Database Tools trên Windows hoặc dùng script restore-mongo-archive-to-docker.ps1 (chạy mongorestore trong container).

$ErrorActionPreference = "Stop"
# Thư mục gốc repo Assign-refu-manager-service (cha của scripts/)
$Root = Split-Path -Parent $PSScriptRoot

$Dump = Join-Path $Root "mongo-seed\dump\giaodich_voucher"
if (-not (Test-Path $Dump)) {
  Write-Error "Không thấy thư mục dump: $Dump — đặt output mongorestore vào đó rồi chạy lại."
}

$Port = if ($env:MONGO_HOST_PORT) { [int]$env:MONGO_HOST_PORT } else { 27018 }
$Uri = "mongodb://127.0.0.1:$Port"

Write-Host "mongorestore -> $Uri , drop, from $Dump"
& mongorestore --uri $Uri --drop $Dump
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Xong."
