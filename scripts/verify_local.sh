#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATABASE_FILE="${PROJECT_ROOT}/database/database.db"
PORT="${PORT:-8000}"
SERVER_URL="http://127.0.0.1:${PORT}"
SERVER_PID=""
SERVER_LOG="$(mktemp -t whats-my-stuff-php-server.XXXXXX.log)"

cleanup() {
    if [ -n "${SERVER_PID}" ] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
        kill "${SERVER_PID}" >/dev/null 2>&1 || true
        wait "${SERVER_PID}" 2>/dev/null || true
    fi
    rm -f "${SERVER_LOG}"
}

trap cleanup EXIT

explain_missing_dependency() {
    local command_name="$1"

    case "${command_name}" in
        php)
            echo "Missing php: needed to run the PHP app, PHP syntax checks, and the local PHP server."
            echo "Install with: brew install php"
            ;;
        sqlite3)
            echo "Missing sqlite3: needed to initialize and inspect database/database.db."
            echo "Install with: brew install sqlite"
            ;;
        curl)
            echo "Missing curl: needed to run local HTTP smoke tests against the PHP server."
            echo "Install with: brew install curl"
            ;;
        git)
            echo "Missing git: needed to check out the repository and enumerate tracked PHP files."
            echo "Install with: brew install git"
            ;;
    esac
}

require_command() {
    local command_name="$1"

    if ! command -v "${command_name}" >/dev/null 2>&1; then
        explain_missing_dependency "${command_name}"
        return 1
    fi
}

echo "Checking required local tools..."
missing=0
for command_name in php sqlite3 curl git; do
    require_command "${command_name}" || missing=1
done

if [ "${missing}" -ne 0 ]; then
    echo "Install only the missing dependencies above, then rerun this script."
    exit 1
fi

echo
echo "Running required version/module checks..."
php --version
php -m
if ! php -m | grep -Eiq '^sqlite3$'; then
    echo "PHP sqlite3 extension is missing: the backend uses PHP's SQLite3 class."
    echo "Homebrew PHP normally includes it. Try: brew reinstall php"
    exit 1
fi
sqlite3 --version
curl --version
git --version

echo
echo "Running PHP syntax checks..."
while IFS= read -r php_file; do
    php -l "${PROJECT_ROOT}/${php_file}"
done < <(git -C "${PROJECT_ROOT}" ls-files '*.php')

echo
echo "Running setup script..."
bash "${PROJECT_ROOT}/scripts/setup.sh"

echo
echo "Verifying SQLite database initialization..."
sqlite3 "${DATABASE_FILE}" 'PRAGMA integrity_check;'
sqlite3 "${DATABASE_FILE}" '.schema items'

echo
echo "Starting local PHP server on ${SERVER_URL}..."
php -S "127.0.0.1:${PORT}" -t "${PROJECT_ROOT}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID="$!"

for attempt in 1 2 3 4 5; do
    if curl -fsS "${SERVER_URL}/frontend/index.html" >/dev/null 2>&1; then
        break
    fi

    if [ "${attempt}" -eq 5 ]; then
        echo "Local PHP server did not become ready. Server log:"
        cat "${SERVER_LOG}"
        exit 1
    fi

    sleep 1
done

echo
echo "Running HTTP smoke tests..."
save_status="$(
    curl -sS -o /tmp/whats-my-stuff-save-response.json -w '%{http_code}' \
        -X POST "${SERVER_URL}/backend/save_image.php" \
        --data-urlencode 'image=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
)"

if [ "${save_status}" != "201" ]; then
    echo "Save endpoint failed with HTTP ${save_status}:"
    cat /tmp/whats-my-stuff-save-response.json
    exit 1
fi

php -r '$data = json_decode(file_get_contents("/tmp/whats-my-stuff-save-response.json"), true); exit(isset($data["status"], $data["item"]["id"]) && $data["status"] === "success" ? 0 : 1);'

list_status="$(
    curl -sS -o /tmp/whats-my-stuff-list-response.json -w '%{http_code}' \
        "${SERVER_URL}/backend/marketplace/list_items.php"
)"

if [ "${list_status}" != "200" ]; then
    echo "List endpoint failed with HTTP ${list_status}:"
    cat /tmp/whats-my-stuff-list-response.json
    exit 1
fi

php -r '$data = json_decode(file_get_contents("/tmp/whats-my-stuff-list-response.json"), true); exit(isset($data["status"], $data["items"]) && $data["status"] === "success" && is_array($data["items"]) && count($data["items"]) > 0 ? 0 : 1);'

rm -f /tmp/whats-my-stuff-save-response.json /tmp/whats-my-stuff-list-response.json

echo
echo "Local verification completed successfully."
