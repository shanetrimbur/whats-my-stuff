#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Initialize the SQLite database
mkdir -p "${PROJECT_ROOT}/database" "${PROJECT_ROOT}/uploads/items"
DATABASE_FILE="${PROJECT_ROOT}/database/database.db"

if [ -f "${DATABASE_FILE}" ] && ! sqlite3 "${DATABASE_FILE}" 'PRAGMA schema_version;' >/dev/null 2>&1; then
    echo "Existing database file is invalid. Recreating ${DATABASE_FILE}."
    rm "${DATABASE_FILE}"
fi

sqlite3 "${DATABASE_FILE}" < "${PROJECT_ROOT}/database/init.sql"

echo "Setup complete! Database initialized."
