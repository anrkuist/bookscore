#!/usr/bin/env bash
#
# BookScore macOS validation-harness slice
# Runs tests outside of the Next.js dev server, utilizing the compiled/packaged
# app's static files and embedded WebDriver server.
#
set -euo pipefail

WEBDRIVER_PORT=4445
TIMEOUT=180
POLL_INTERVAL=3

# Locate built binary path
# In Tauri, tauri build packages the app statically.
# When --features webdriver is enabled, the compiled binary hosts a W3C WebDriver server on port 4445.
# On macOS, it compiles into src-tauri/target/debug/bundle/macos/Readest.app (with tauri build --debug)
APP_PATH="src-tauri/target/debug/bundle/macos/Readest.app"
BINARY_PATH="${APP_PATH}/Contents/MacOS/readest"

cleanup() {
  echo "Stopping launched macOS app..."
  if [[ -n "${TAURI_PID:-}" ]]; then
    pkill -P "$TAURI_PID" 2>/dev/null || true
    kill "$TAURI_PID" 2>/dev/null || true
    wait "$TAURI_PID" 2>/dev/null || true
  fi
  # Kill any remaining process listening on the webdriver port
  lsof -ti :"$WEBDRIVER_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Ensure clean slate
lsof -ti :"$WEBDRIVER_PORT" 2>/dev/null | xargs kill 2>/dev/null || true

# 1. Build the Tauri app statically with webdriver enabled (no dev server needed)
echo "Building static frontend and compiling macOS app with webdriver feature..."
if [ ! -d "src-tauri/target/debug/bundle/macos/Readest.app" ]; then
  echo "App not found at target path. Performing clean build..."
  pnpm build
  dotenv -e .env.tauri -- tauri build --debug --features webdriver
else
  echo "Found existing debug app at ${APP_PATH}. Running compiler update checks..."
  dotenv -e .env.tauri -- tauri build --debug --features webdriver
fi

# 2. Launch the compiled macOS app directly
echo "Launching packaged app at ${BINARY_PATH}..."
dotenv -e .env.tauri -- "${BINARY_PATH}" &
TAURI_PID=$!

# 3. Wait for the embedded W3C WebDriver server to start
echo "Waiting for W3C WebDriver server on port ${WEBDRIVER_PORT} (timeout ${TIMEOUT}s)..."
elapsed=0
while ! curl -sf "http://127.0.0.1:${WEBDRIVER_PORT}/status" >/dev/null 2>&1; do
  if ! kill -0 "$TAURI_PID" 2>/dev/null; then
    echo "ERROR: Packaged macOS app exited unexpectedly."
    exit 1
  fi
  if (( elapsed >= TIMEOUT )); then
    echo "ERROR: Timed out waiting for WebDriver on port ${WEBDRIVER_PORT}."
    exit 1
  fi
  sleep "$POLL_INTERVAL"
  (( elapsed += POLL_INTERVAL ))
done

echo "WebDriver is ready. Running BookScore validation tests..."
# Run the specific WebView integration test file via vitest
pnpm vitest --config vitest.tauri.config.mts --watch=false --run src/__tests__/tauri/bookscoreValidation.tauri.test.ts

echo "Harness run complete!"
