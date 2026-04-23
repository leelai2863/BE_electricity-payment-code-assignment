# Restore file archive mongodump nén gzip (vd. mongodump --archive --gzip) vào Mongo trong container Docker.
# Mặc định: container giaodich-mongo, không auth, URI nội bộ mongod trong container.
#
# Cách dùng (từ thư mục Assign-refu-manager-service):
#   .\scripts\restore-mongo-archive-to-docker.ps1 -ArchivePath .\assign_refu_prod.gz
#
# Tham số tuỳ chọn:
#   -ContainerName  giaodich-mongo
#   -NsInclude      giaodich_voucher.*   (chỉ restore một DB; để trống = toàn bộ archive)

param(
  [Parameter(Mandatory = $true)]
  [string] $ArchivePath,
  [string] $ContainerName = "giaodich-mongo",
  [string] $NsInclude = ""
)

$ErrorActionPreference = "Stop"
$ArchivePath = (Resolve-Path $ArchivePath).Path

$running = docker ps --filter "name=$ContainerName" --format "{{.Names}}"
if ($running -ne $ContainerName) {
  Write-Error "Container '$ContainerName' chưa chạy. Trong thư mục repo: docker compose up -d"
}

$remote = "/tmp/mongo_restore_archive.gz"
Write-Host "docker cp -> ${ContainerName}:$remote"
docker cp $ArchivePath "${ContainerName}:$remote"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$ns = $NsInclude.Trim()
$cmd = "mongorestore --gzip --archive=$remote --uri=mongodb://127.0.0.1:27017 --drop"
if ($ns.Length -gt 0) {
  $cmd += " --nsInclude=$ns"
}

Write-Host "docker exec $ContainerName sh -c `"$cmd`""
docker exec $ContainerName sh -c $cmd
$code = $LASTEXITCODE
docker exec $ContainerName rm -f $remote | Out-Null
if ($code -ne 0) { exit $code }

Write-Host "Restore archive xong. Kiểm tra: docker exec $ContainerName mongosh giaodich_voucher --eval 'db.stats()'"
