#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SSH_HOST="${ATLOS_CN_SSH_HOST:-atlos-cn}"
REMOTE_DIR="${ATLOS_CN_REMOTE_DIR:-workspace/atlos-assets/_WORK_DIR/Atlos/talos}"
SKIP_BUILD="${ATLOS_CN_SKIP_BUILD:-0}"

usage() {
    cat <<'EOF'
Usage: deploy-cn-server.sh [options]

Build the CN frontend, publish it to OSS, and replace the server dist/.

Options:
  --skip-build          Publish the existing local dist/ without running pnpm build
  --host HOST           SSH host or ~/.ssh/config alias (default: atlos-cn)
  --remote-dir PATH     Remote talos directory
  -h, --help            Show this help

Environment overrides:
  ATLOS_CN_SSH_HOST
  ATLOS_CN_REMOTE_DIR
  ATLOS_CN_SKIP_BUILD=1
EOF
}

while (($# > 0)); do
    case "$1" in
        --skip-build)
            SKIP_BUILD=1
            shift
            ;;
        --host)
            [[ $# -ge 2 ]] || { echo "Missing value for --host" >&2; exit 2; }
            SSH_HOST="$2"
            shift 2
            ;;
        --host=*)
            SSH_HOST="${1#*=}"
            shift
            ;;
        --remote-dir)
            [[ $# -ge 2 ]] || { echo "Missing value for --remote-dir" >&2; exit 2; }
            REMOTE_DIR="$2"
            shift 2
            ;;
        --remote-dir=*)
            REMOTE_DIR="${1#*=}"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

for command in pnpm zip scp ssh; do
    command -v "$command" >/dev/null 2>&1 || {
        echo "Required command not found: $command" >&2
        exit 1
    }
done

if [[ "$REMOTE_DIR" =~ [[:space:]] ]]; then
    echo "Remote directory must not contain whitespace: $REMOTE_DIR" >&2
    exit 2
fi

cd "$ROOT"

if [[ "$SKIP_BUILD" != "1" ]]; then
    echo "==> Building CN frontend"
    pnpm build
else
    echo "==> Skipping build; using existing dist/"
fi

if [[ ! -f dist/index.html ]]; then
    echo "dist/index.html not found; CN build is missing or incomplete." >&2
    exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/atlos-cn-deploy.XXXXXX")"
ARCHIVE_PATH="${TEMP_DIR}/dist.zip"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "==> Packaging dist/"
zip -qr "$ARCHIVE_PATH" dist

deploy_server_dist() {
    echo "==> Uploading to ${SSH_HOST}:${REMOTE_DIR}/dist.zip.uploading"
    scp "$ARCHIVE_PATH" "${SSH_HOST}:${REMOTE_DIR}/dist.zip.uploading"

    echo "==> Replacing remote dist/"
    ssh "$SSH_HOST" bash -s -- "$REMOTE_DIR" <<'REMOTE_SCRIPT'
set -euo pipefail

remote_dir="$1"
cd "$remote_dir"

mv -f dist.zip.uploading dist.zip
rm -rf .dist-next
mkdir .dist-next
unzip -q -o dist.zip -d .dist-next

if [[ ! -f .dist-next/dist/index.html ]]; then
    echo "Uploaded archive does not contain dist/index.html" >&2
    rm -rf .dist-next
    exit 1
fi

rm -rf dist.previous
if [[ -d dist ]]; then
    mv dist dist.previous
fi

if mv .dist-next/dist dist; then
    rm -rf dist.previous .dist-next dist.zip
else
    if [[ -d dist.previous ]]; then
        mv dist.previous dist
    fi
    rm -rf .dist-next
    exit 1
fi
REMOTE_SCRIPT

    echo "==> Server dist deployed to ${SSH_HOST}:${REMOTE_DIR}/dist"
}

echo "==> Publishing CN dist to OSS while deploying the server dist"
pnpm publish:web &
PUBLISH_PID=$!

SERVER_STATUS=0
deploy_server_dist || SERVER_STATUS=$?

PUBLISH_STATUS=0
wait "$PUBLISH_PID" || PUBLISH_STATUS=$?

if ((PUBLISH_STATUS != 0 || SERVER_STATUS != 0)); then
    if ((PUBLISH_STATUS != 0)); then
        echo "publish:web failed with exit code $PUBLISH_STATUS" >&2
    fi
    if ((SERVER_STATUS != 0)); then
        echo "Server dist deployment failed with exit code $SERVER_STATUS" >&2
    fi
    exit 1
fi

echo "==> CN release complete: OSS publish and server dist deployment succeeded"
