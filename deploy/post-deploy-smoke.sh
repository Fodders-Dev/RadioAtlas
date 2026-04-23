#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${BASE_URL:-https://radioatlas.duckdns.org}"
BASE_URL="${BASE_URL%/}"
API_BASE="${API_BASE:-${BASE_URL}/api}"

fetch() {
  local url="$1"
  curl --fail --silent --show-error --location "$url"
}

echo "Smoke: API health"
if ! fetch "${API_BASE}/health" >/dev/null 2>&1; then
  fetch "${BASE_URL}/health" >/dev/null
fi

echo "Smoke: billing catalog"
fetch "${API_BASE}/billing/telegram/products" >/dev/null

echo "Smoke: auth providers"
fetch "${API_BASE}/auth/providers" >/dev/null

echo "Smoke: catalog summary JSON"
summary_json="$(fetch "${API_BASE}/catalog/summary?seed=1")"
if grep -qiE '<!doctype|<html|Cannot GET' <<<"$summary_json"; then
  echo "Catalog summary returned HTML instead of JSON." >&2
  exit 1
fi
if ! grep -q '"counts"' <<<"$summary_json"; then
  echo "Catalog summary payload does not include counts." >&2
  exit 1
fi

echo "Smoke: canonical shell"
html="$(fetch "${BASE_URL}")"

if grep -q 'radio-atlas-miniapp\.vercel\.app/api' <<<"$html"; then
  echo "Legacy Vercel API origin is still referenced by the canonical shell." >&2
  exit 1
fi

entry_asset="$(grep -oE '/assets/index-[^"]+\.js' <<<"$html" | head -n 1)"
if [[ -z "$entry_asset" ]]; then
  echo "Could not find the entry asset in the canonical shell." >&2
  exit 1
fi

echo "Smoke: compressed entry asset"
entry_js="$(curl --fail --silent --show-error --location --compressed "${BASE_URL}${entry_asset}")"

stylesheet_asset="$(grep -oE '/assets/index-[^"]+\.css' <<<"$html" | head -n 1)"
if [[ -n "$stylesheet_asset" ]]; then
  echo "Smoke: compressed stylesheet asset"
  curl --fail --silent --show-error --location --compressed "${BASE_URL}${stylesheet_asset}" >/dev/null
fi

echo "Smoke: startup JS dependencies"
startup_assets="$(grep -oE '\./[^"]+\.js' <<<"$entry_js" | sed 's#^\./#/assets/#' | sort -u || true)"
if [[ -n "$startup_assets" ]]; then
  while IFS= read -r asset; do
    [[ -z "$asset" ]] && continue
    curl --fail --silent --show-error --location --compressed "${BASE_URL}${asset}" >/dev/null
  done <<<"$startup_assets"
fi

bootstrap_asset="$(grep -oE '/assets/BootstrapApp-[^"]+\.js' <<<"$entry_js" | head -n 1)"
bootstrap_js=""
if [[ -n "$bootstrap_asset" ]]; then
  echo "Smoke: BootstrapApp startup dependencies"
  bootstrap_js="$(curl --fail --silent --show-error --location --compressed "${BASE_URL}${bootstrap_asset}")"
  bootstrap_assets="$(grep -oE '\./[^"]+\.(js|css)' <<<"$bootstrap_js" | sed 's#^\./#/assets/#' | sort -u || true)"
  if [[ -n "$bootstrap_assets" ]]; then
    while IFS= read -r asset; do
      [[ -z "$asset" ]] && continue
      curl --fail --silent --show-error --location --compressed "${BASE_URL}${asset}" >/dev/null
    done <<<"$bootstrap_assets"
  fi
fi

providers_asset="$(grep -oE '/assets/AppProviders-[^"]+\.js' <<<"$bootstrap_js" | head -n 1)"
if [[ -n "$providers_asset" ]]; then
  echo "Smoke: AppProviders startup dependencies"
  providers_js="$(curl --fail --silent --show-error --location --compressed "${BASE_URL}${providers_asset}")"
  providers_assets="$(grep -oE '\./[^"]+\.(js|css)' <<<"$providers_js" | sed 's#^\./#/assets/#' | sort -u || true)"
  if [[ -n "$providers_assets" ]]; then
    while IFS= read -r asset; do
      [[ -z "$asset" ]] && continue
      curl --fail --silent --show-error --location --compressed "${BASE_URL}${asset}" >/dev/null
    done <<<"$providers_assets"
  fi
fi

echo "Smoke: missing hashed asset should not fall back to index"
missing_asset_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "${BASE_URL}/assets/__missing__.js")"
if [[ "$missing_asset_status" != "404" ]]; then
  echo "Missing hashed asset returned ${missing_asset_status} instead of 404." >&2
  exit 1
fi

echo "Smoke checks passed."
