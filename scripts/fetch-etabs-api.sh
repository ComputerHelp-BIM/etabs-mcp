#!/usr/bin/env bash
# Fetches a reference copy of ETABSv1.dll (the CSI ETABS API) for builds on machines
# without ETABS installed, such as GitHub-hosted CI runners.
#
#   scripts/fetch-etabs-api.sh [output-dir]      (default: .etabs-api)
#   dotnet build plugin/EtabsBridge.sln -c Release -p:EtabsInstallDir=$PWD/.etabs-api
#
# Source: the UNOFFICIAL NuGet package "CSIAPIv1-All" (a third-party redistribution of the
# DLLs that ship with ETABS; CSI publishes no official package). It is pinned by version and
# SHA-256, so a changed or tampered package fails the build instead of being used.
#
# The DLL is a COMPILE-TIME REFERENCE ONLY: it is never executed by the build and never
# shipped (EtabsApi.targets sets Private=false). At run time the plugin binds to the
# ETABSv1.dll inside the user's ETABS, identified by name, version 1.0.0.0 and CSI's
# public key token, which EtabsApi.targets verifies on every build.
#
# Prefer your own ETABS install when you have one: -p:EtabsInstallDir="C:\Program Files\...\ETABS 22".
set -euo pipefail

PACKAGE_ID="CSIAPIv1-All"
PACKAGE_VERSION="2.12.0"
PACKAGE_SHA256="327e699c22e4a07678e5f6f1ac0e734f0c3dec37ac0ef3c66a66375c917e0ba6"
# netstandard2.0 build of ETABSv1: referenced by both the net48 and net8.0-windows plugin.
DLL_IN_PACKAGE="lib/netstandard2.0/ETABSv1.dll"

OUT_DIR="${1:-.etabs-api}"
URL="https://www.nuget.org/api/v2/package/${PACKAGE_ID}/${PACKAGE_VERSION}"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

if [[ -f "${OUT_DIR}/ETABSv1.dll" && -f "${OUT_DIR}/.package" && "$(cat "${OUT_DIR}/.package")" == "${PACKAGE_ID} ${PACKAGE_VERSION} ${PACKAGE_SHA256}" ]]; then
  echo "ETABS API reference already present: ${OUT_DIR}/ETABSv1.dll (${PACKAGE_ID} ${PACKAGE_VERSION})"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "Downloading ${PACKAGE_ID} ${PACKAGE_VERSION} ..."
curl --fail --silent --show-error --location --retry 4 --retry-delay 2 -o "${WORK}/package.nupkg" "${URL}"

ACTUAL="$(sha256_of "${WORK}/package.nupkg")"
if [[ "${ACTUAL}" != "${PACKAGE_SHA256}" ]]; then
  echo "::error::SHA-256 mismatch for ${PACKAGE_ID} ${PACKAGE_VERSION}: expected ${PACKAGE_SHA256}, got ${ACTUAL}. Refusing to use it." >&2
  exit 1
fi

# Extract only the one file we need (Python's zipfile is on every CI image; unzip is not).
# Probe by running: on Windows "python3" can be the Microsoft Store placeholder, which fails.
PYTHON=""
for candidate in python3 python py; do
  if "${candidate}" -c "import zipfile" >/dev/null 2>&1; then PYTHON="${candidate}"; break; fi
done
if [[ -z "${PYTHON}" ]]; then
  echo "::error::Python is required to extract the package." >&2
  exit 1
fi
mkdir -p "${OUT_DIR}"
"${PYTHON}" - "${WORK}/package.nupkg" "${DLL_IN_PACKAGE}" "${OUT_DIR}/ETABSv1.dll" <<'PY'
import shutil, sys, zipfile
package, member, target = sys.argv[1:4]
with zipfile.ZipFile(package) as z, z.open(member) as src, open(target, "wb") as dst:
    shutil.copyfileobj(src, dst)
PY

echo "${PACKAGE_ID} ${PACKAGE_VERSION} ${PACKAGE_SHA256}" > "${OUT_DIR}/.package"
echo "ETABS API reference ready: ${OUT_DIR}/ETABSv1.dll"
