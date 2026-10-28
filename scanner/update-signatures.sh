#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p signatures
# Only public vendor definitions enter this updater; it never sees PDFs.
docker run --rm --user root --entrypoint sh \
  -v "$PWD/signatures:/var/lib/clamav" \
  -v "$PWD/freshclam.conf:/scanner-freshclam.conf:ro" \
  clamav/clamav:1.4.6_base-debian13-slim -c \
  'chown clamav:clamav /var/lib/clamav; freshclam --config-file=/scanner-freshclam.conf --stdout; chmod -R a+rX /var/lib/clamav'
