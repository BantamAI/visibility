#!/usr/bin/env bash
# Runs every pgTAP file in test/pgtap against DATABASE_URL, a migrated database whose
# server has the pgtap extension available. Each file rolls itself back.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL must point at a migrated visibility database with pgTAP available." >&2
	exit 2
fi

cd "$(dirname "$0")/../test/pgtap"
status=0
for file in *.sql; do
	echo "# $file"
	psql "$DATABASE_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$file" || status=1
done
exit $status
