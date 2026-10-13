#!/usr/bin/env bash
# Verifies every late-bound ETABS API call in EtabsBridge.Core against a real ETABSv1.dll.
#   scripts/check-etabs-api.sh [path-to-ETABSv1.dll]
# Without an argument it uses the pinned reference copy from scripts/fetch-etabs-api.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DLL="${1:-}"
if [[ -z "${DLL}" ]]; then
  "${ROOT}/scripts/fetch-etabs-api.sh" "${ROOT}/.etabs-api"
  DLL="${ROOT}/.etabs-api/ETABSv1.dll"
fi
cd "${ROOT}"
dotnet run -c Release --project plugin/tools/ApiContractCheck -- "${DLL}" plugin/src/EtabsBridge.Core
