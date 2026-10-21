#!/usr/bin/env bash
# Repairs call recordings that were saved 3x slowed down (deep, slow "ghost" voice).
#
# Until 2026-10-14 MixMonitor wrote straight to an 8 kHz WAV. On calls whose audio rate rose midway -
# every outgoing web phone call with ringback: G.722 from the trunk first, then Opus (48 kHz) from the
# browser - Asterisk's audiohook kept its 16->8 kHz resampler and fed it 48 kHz audio, so the file holds
# 24 kHz audio labelled 8 kHz. Nothing is lost: playing it 3x faster restores the call exactly.
#
# A recording is repaired only when it is ~3x as long as the call's billed time (from the CSV CDR;
# billsec is truncated, so a slowed file lasts between 3*billsec and 3*(billsec+1) seconds). Originals
# are kept in the backup folder; file times are preserved (retention and "recorded at" use them).
# Idempotent - repaired files are ~1x and are skipped on later runs. Runs as the app user (member of
# the asterisk group); no sudo needed.
#
#   scp deploy/scripts/fix-slow-recordings.sh enfinito@103.129.209.29:/tmp/
#   ssh enfinito@103.129.209.29 'bash /tmp/fix-slow-recordings.sh'           # dry run: lists files
#   ssh enfinito@103.129.209.29 'bash /tmp/fix-slow-recordings.sh --apply'   # repair them
set -euo pipefail

MONITOR="${ENVO_MONITOR_DIR:-/var/spool/asterisk/monitor/envo}"
CDR_CSV="${ENVO_CDR_CSV:-/var/log/asterisk/cdr-csv/Master.csv}"
BACKUP="${ENVO_BACKUP_DIR:-$HOME/envo-backups/recordings-3x-slow}"
# Optional: only look at files older than this ("YYYY-MM-DD HH:MM:SS", server time).
BEFORE="${ENVO_FIXED_AT:-}"
APPLY=0
[ "${1:-}" = --apply ] && APPLY=1

command -v sox >/dev/null || { echo "sox is not installed" >&2; exit 1; }
[ -r "$CDR_CSV" ] || { echo "cannot read $CDR_CSV" >&2; exit 1; }

# <relative path> per line: files ~3x longer than the billed call time.
list_slow() {
  python3 -I - "$MONITOR" "$CDR_CSV" "$BEFORE" <<'PY'
import csv, glob, os, sys, datetime
monitor, cdr_csv, before = sys.argv[1:4]
cutoff = datetime.datetime.strptime(before, '%Y-%m-%d %H:%M:%S').timestamp() if before else None
billsec = {}
with open(cdr_csv, newline='', encoding='utf-8', errors='replace') as fh:
    for row in csv.reader(fh):
        # accountcode,src,dst,dcontext,clid,channel,dstchannel,lastapp,lastdata,start,answer,end,
        # duration,billsec,disposition,amaflags,uniqueid,...
        if len(row) > 16 and row[14] == 'ANSWERED' and row[13].isdigit():
            billsec[row[16]] = max(billsec.get(row[16], 0), int(row[13]))
for path in sorted(glob.glob(os.path.join(monitor, 't*', '*', '*', '*', '*.wav'))):
    st = os.stat(path)
    if (cutoff is not None and st.st_mtime >= cutoff) or st.st_size <= 44:
        continue
    bill = billsec.get(os.path.basename(path)[:-4], 0)
    seconds = (st.st_size - 44) / 16000   # 8 kHz 16-bit mono
    # A correct recording lasts at most about bill + 1 s, below 2.7 * bill for any bill >= 1.
    if bill >= 1 and 2.7 * bill <= seconds <= 3.4 * bill + 3:
        print(os.path.relpath(path, monitor))
PY
}

out="$(list_slow)"
FILES=()
[ -n "$out" ] && mapfile -t FILES <<<"$out"
echo "[fix-slow-recordings] ${#FILES[@]} recording(s) play 3x slowed down"
if [ "$APPLY" = 0 ]; then
  [ "${#FILES[@]}" -gt 0 ] && printf '  %s\n' "${FILES[@]}"
  echo "[fix-slow-recordings] dry run - run again with --apply to repair them (originals go to $BACKUP)"
  exit 0
fi

tmp=""
trap 'rm -f "$tmp"' EXIT
fixed=0
for rel in "${FILES[@]}"; do
  src="$MONITOR/$rel"
  tmp="$src.fixing"
  mkdir -p "$BACKUP/$(dirname "$rel")"
  [ -e "$BACKUP/$rel" ] || cp -p "$src" "$BACKUP/$rel"
  # The file is 8 kHz; "speed 3" restores tempo and pitch and resamples back to 8 kHz.
  if sox -V1 -D "$src" -t wav "$tmp" speed 3; then
    touch -r "$src" "$tmp"
    chmod 664 "$tmp"
    chgrp asterisk "$tmp" 2>/dev/null || true
    mv -f "$tmp" "$src"
    fixed=$((fixed + 1))
  else
    rm -f "$tmp"
    echo "[fix-slow-recordings] could not convert $rel" >&2
  fi
done
tmp=""
echo "[fix-slow-recordings] repaired $fixed of ${#FILES[@]}; originals in $BACKUP"
echo "[fix-slow-recordings] listen to a few calls, then delete the originals: rm -rf $BACKUP"
