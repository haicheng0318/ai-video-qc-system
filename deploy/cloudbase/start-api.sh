#!/bin/sh
set -eu

# Migrations and initial-account bootstrap are explicit maintenance operations.
# A restart must not mutate the schema or silently create an administrator.
cd /app/apps/api
exec node dist/main.js
