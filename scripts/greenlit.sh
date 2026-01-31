#!/usr/bin/env bash
#
# Greenlit CLI Wrapper
# Runs the Greenlit triage agent via Node.js
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Check for required environment variables
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Error: OPENAI_API_KEY environment variable is required"
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN environment variable is required"
  exit 1
fi

# Run the CLI
exec node "$PROJECT_DIR/dist/index.js" "$@"
