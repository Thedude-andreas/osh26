#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
node --input-type=module - "${vinext}" "${SITES_BUILD_TIMEOUT:-3m}" "${SITES_BUILD_KILL_AFTER:-10s}" <<'NODE'
import { spawn } from "node:child_process";

const [command, timeoutValue, killAfterValue] = process.argv.slice(2);

function durationToMs(value) {
  const match = /^(\d+)(ms|s|m)?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  return amount * ({ ms: 1, s: 1000, m: 60_000 })[unit];
}

const timeoutMs = durationToMs(timeoutValue);
const killAfterMs = durationToMs(killAfterValue);
const child = spawn(command, ["build"], { stdio: "inherit" });

const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), killAfterMs).unref();
}, timeoutMs);

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  if (signal) {
    console.error(`vinext build stopped by ${signal}`);
    process.exit(124);
  }
  process.exit(code ?? 1);
});
NODE

"${script_dir}/validate-artifact.sh"
