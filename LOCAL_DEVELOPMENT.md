# Local Development on macOS Apple Silicon

This project is configured for local development on macOS using local tools only. It does not require remote build agents, cloud execution, or paid services.

## Required tools

Install only the tools this PHP/SQLite app needs:

- PHP CLI, including the `sqlite3` PHP extension
- SQLite3
- curl
- git

On macOS Apple Silicon, Homebrew is the preferred package source when a dependency is missing.

## One-time dependency setup

1. Install Homebrew if it is not already installed:

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. Install the project dependencies:

   ```bash
   brew install php sqlite curl git
   ```

   Why each package is needed:

   - `php`: runs the PHP app, local development server, syntax checks, and provides the `SQLite3` class used by the backend.
   - `sqlite`: provides the `sqlite3` command used by `scripts/setup.sh` and database verification.
   - `curl`: performs local HTTP smoke tests against the PHP server.
   - `git`: checks out the repository and enumerates tracked PHP files for syntax checks.

3. Verify the installed tools:

   ```bash
   php --version
   php -m
   sqlite3 --version
   curl --version
   git --version
   ```

   Confirm `php -m` includes `sqlite3`. Homebrew's PHP package normally includes it.

## Project setup

From the repository root:

```bash
bash scripts/setup.sh
```

This creates:

- `database/database.db`
- `uploads/items/`

Both are local runtime artifacts and are intentionally ignored by git.

## Run the app locally

From the repository root:

```bash
php -S 127.0.0.1:8000
```

Then open:

```text
http://127.0.0.1:8000/frontend/index.html
```

## Full local verification

Run:

```bash
bash scripts/verify_local.sh
```

The script verifies:

- `php --version`
- `php -m`
- `sqlite3 --version`
- `curl --version`
- `git --version`
- PHP syntax for tracked PHP files
- database setup through `scripts/setup.sh`
- SQLite database initialization
- local HTTP smoke tests for:
  - `POST /backend/save_image.php`
  - `GET /backend/marketplace/list_items.php`

If a required dependency is missing, the script explains why it is needed and suggests the smallest Homebrew package set for this project.
