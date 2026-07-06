#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Initialize the SQLite database
mkdir -p "${PROJECT_ROOT}/database" "${PROJECT_ROOT}/uploads/items"
sqlite3 "${PROJECT_ROOT}/database/database.db" < "${PROJECT_ROOT}/database/init.sql"

echo "Setup complete! Database initialized."
