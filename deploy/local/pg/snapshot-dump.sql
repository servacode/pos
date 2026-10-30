-- Used by backup.sh: the dump and the fingerprint come from the SAME snapshot, so the counts in the
-- manifest are exactly what the dump holds, even while the shop keeps selling.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SELECT pg_export_snapshot() AS snapshot \gset
\setenv SERVA_SNAPSHOT :snapshot
\! pg_dump --format=custom --compress=6 --no-password --snapshot="$SERVA_SNAPSHOT" --dbname="$SERVA_DB" --file="$SERVA_WORK/dump"; echo $? > "$SERVA_WORK/dump.status"
\o :stats_file
\ir table-stats.sql
\o
COMMIT;
