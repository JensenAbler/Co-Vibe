#!/usr/bin/env bash
# Start both the Python analysis backend and the Vite frontend dev server.
# Usage: ./dev.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Co Vibe development servers..."
echo ""

# Start FastAPI backend
echo "[backend] Starting FastAPI on http://localhost:8000"
cd "$SCRIPT_DIR/analysis"
.venv/Scripts/uvicorn api.server:app --reload --port 8000 &
BACKEND_PID=$!

# Start Vite frontend
echo "[frontend] Starting Vite on http://localhost:5173"
cd "$SCRIPT_DIR/frontend"
npx vite --port 5173 &
FRONTEND_PID=$!

echo ""
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Press Ctrl+C to stop both servers."

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT

wait
