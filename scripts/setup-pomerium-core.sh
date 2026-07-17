#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="$repo_root/.pomerium"

mkdir -p "$state_dir"
chmod 700 "$state_dir"

if command -v mkcert >/dev/null 2>&1; then
  mkcert -install
  mkcert \
    -cert-file "$state_dir/core-cert.pem" \
    -key-file "$state_dir/core-key.pem" \
    '*.localhost.pomerium.io'
  cp "$(mkcert -CAROOT)/rootCA.pem" "$state_dir/core-ca.pem"
  echo "Created a browser-trusted local certificate with mkcert."
else
  openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
    -keyout "$state_dir/core-key.pem" \
    -out "$state_dir/core-cert.pem" \
    -subj '/CN=*.localhost.pomerium.io' \
    -addext 'subjectAltName=DNS:*.localhost.pomerium.io'
  cp "$state_dir/core-cert.pem" "$state_dir/core-ca.pem"
  echo "mkcert was not found; created a seven-day CLI-only self-signed certificate."
  echo "Install mkcert and rerun this script if you also want browser-trusted TLS."
fi

umask 077
{
  printf 'SHARED_SECRET=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
  printf 'COOKIE_SECRET=%s\n' "$(openssl rand -base64 32 | tr -d '\n')"
} > "$state_dir/core.env"

echo "Created local TLS material, a client CA certificate, and Core secrets under .pomerium/."
echo "These files are gitignored and are for local testing only."
