#!/bin/bash
set -euo pipefail
# Runs once on first Mongo container start (empty data volume only).
DUMP_DIR="/docker-entrypoint-initdb.d/dump"
if [ ! -d "$DUMP_DIR/giaodich_voucher" ]; then
  echo "mongo-seed: skip restore — put mongodump output under mongo-seed/dump/ (expect mongo-seed/dump/giaodich_voucher/)"
  exit 0
fi
echo "mongo-seed: restoring giaodich_voucher from $DUMP_DIR ..."
mongorestore --dir="$DUMP_DIR" --drop
