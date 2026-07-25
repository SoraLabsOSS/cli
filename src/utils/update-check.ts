const REGISTRY_URL =
  "https://registry.npmjs.org/@soralabsoss%2Fsora-cli/latest";
const CHECK_TIMEOUT_MS = 1000;

export function parseVersionParts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewer(latest: string, current: string): boolean {
  const latestParts = parseVersionParts(latest);
  const currentParts = parseVersionParts(current);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (latestParts[i] ?? 0) - (currentParts[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}

/**
 * Fetches the latest published version from the npm registry, or null when
 * it can't be determined (network error, timeout, non-ok or malformed
 * response). Never throws. Doctor calls this directly (with a longer
 * budget) so it can tell "couldn't check" apart from "up to date".
 */
export function fetchLatestVersion(
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<string | null> {
  return fetch(REGISTRY_URL, { signal: AbortSignal.timeout(timeoutMs) })
    .then((res) =>
      res.ok ? (res.json() as Promise<{ version?: string }>) : null
    )
    .then((data) => data?.version ?? null)
    .catch(() => null);
}

/**
 * Best-effort, non-blocking check against the npm registry for a newer
 * published version. Kicked off in parallel with the command's own work
 * and only awaited (with a short budget) right before the process exits —
 * a slow or unreachable registry must never delay or fail the actual
 * command. Any error (network, timeout, malformed response) resolves to
 * `null` silently.
 */
export function startUpdateCheck(
  currentVersion: string
): Promise<string | null> {
  if (process.env.SORA_NO_UPDATE_CHECK) {
    return Promise.resolve(null);
  }

  return fetchLatestVersion().then((latest) =>
    latest && isNewer(latest, currentVersion) ? latest : null
  );
}

export function printUpdateNotice(latest: string, current: string): void {
  console.error(
    `\nA new version of sora-cli is available: ${current} → ${latest}\nRun "npm i -g @soralabsoss/sora-cli" to update.\n`
  );
}
