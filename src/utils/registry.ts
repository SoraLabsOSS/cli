import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  DEFAULT_REGISTRY,
  DEFAULT_SHADCN_STYLE,
  REGISTRIES,
  SHADCN_REGISTRY_URL_TEMPLATE,
} from "@/constants.js";
import type {
  ComponentAddress,
  ProjectConfig,
  Registry,
  RegistryItem,
} from "@/types.js";
import { sanitize } from "@/utils/colors.js";

/**
 * Distinguishes "this component doesn't exist on that registry" (a 404)
 * from network/shape/server failures — tree resolution falls back to the
 * shadcn base registry only for the former, and must not mask the latter.
 */
export class ComponentNotFoundError extends Error {}

const HTTP_URL = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;
const LEADING_AT = /^@/;
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
// Bounds every registry request — without it, a host that silently drops
// packets (instead of refusing the connection) leaves commands hanging on
// the OS-level TCP timeout, which can run over a minute.
const FETCH_TIMEOUT_MS = 15_000;

/**
 * A custom `--registry`/`SORA_REGISTRY_URL` value is fetched over the
 * network and its response is written straight into the user's project and
 * fed into the package manager — plain HTTP makes that payload tamperable
 * in transit (no integrity/signature verification exists for registry
 * content, same as upstream shadcn). Loopback is exempted so local
 * development/test registries keep working without HTTPS.
 */
export function assertSecureRegistryUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new Error(`Invalid registry URL: "${url}"`, { cause: err });
  }

  if (parsed.protocol === "http:" && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `Registry URL "${url}" must use HTTPS. Plain HTTP is only allowed for localhost during development.`
    );
  }
}

/**
 * `--registry` accepts either a known Sora Labs product key ("ui") or a
 * full URL of any shadcn-compatible registry — the fetch/validation/alias-
 * rewrite/path-resolution logic here doesn't assume anything Sora-specific,
 * so pointing it at a third-party registry (or a private/internal one)
 * works the same way.
 */
export function resolveRegistryUrl(registry?: string): string {
  const envOverride = process.env.SORA_REGISTRY_URL;
  if (envOverride) {
    assertSecureRegistryUrl(envOverride);
    return envOverride;
  }

  if (registry && HTTP_URL.test(registry)) {
    const url = registry.replace(TRAILING_SLASH, "");
    assertSecureRegistryUrl(url);
    return url;
  }

  const key = registry ?? DEFAULT_REGISTRY;
  const url = REGISTRIES[key];

  if (!url) {
    const available = Object.keys(REGISTRIES).join(", ");
    throw new Error(
      `Unknown registry "${key}". Available: ${available}, or pass a full registry URL.`
    );
  }

  return url;
}

async function tryExtractErrorDetail(
  response: Response
): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as {
      detail?: string;
      error?: string;
      message?: string;
    };
    return body.message ?? body.error ?? body.detail ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetches and parses JSON from a registry URL, turning the ways this can
 * fail (network down, non-2xx response, invalid JSON, unexpected shape)
 * into a message that says what happened and what to do about it, rather
 * than a raw `fetch failed` or a crash deep inside tree resolution.
 */
async function fetchJson<T>(
  url: string,
  notFound: () => Error,
  validate: (data: unknown) => asserts data is T,
  headers?: Record<string, string>
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") {
      throw new Error(
        `Request to ${url} timed out after ${FETCH_TIMEOUT_MS / 1000}s. Check your network connection and try again.`,
        { cause: err }
      );
    }
    const cause = (
      err as { cause?: { code?: string; message?: string } } | undefined
    )?.cause;
    const reason = cause?.code ?? cause?.message ?? (err as Error).message;
    throw new Error(
      `Could not reach ${url} (${reason}). Check your network connection and try again.`,
      { cause: err }
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw notFound();
    }
    const detail = await tryExtractErrorDetail(response);
    throw new Error(
      `Registry request to ${url} failed: ${response.status} ${sanitize(response.statusText)}${detail ? ` — ${sanitize(detail)}` : ""}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`Registry at ${url} returned invalid JSON.`, {
      cause: err,
    });
  }

  validate(data);
  return data;
}

function assertRegistry(data: unknown): asserts data is Registry {
  const candidate = data as Partial<Registry> | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.name !== "string" ||
    !Array.isArray(candidate.items)
  ) {
    throw new Error(
      'Malformed registry response: expected an object with "name" and an "items" array.'
    );
  }
}

function assertRegistryItem(data: unknown): asserts data is RegistryItem {
  const candidate = data as Partial<RegistryItem> | null;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.name !== "string" ||
    !Array.isArray(candidate.files)
  ) {
    throw new Error(
      'Malformed component response: expected an object with "name" and a "files" array.'
    );
  }
}

export async function fetchRegistry(registry?: string): Promise<Registry> {
  const baseUrl = resolveRegistryUrl(registry);
  return await fetchJson(
    `${baseUrl}/r/registry.json`,
    () =>
      new Error(
        `Registry not found at ${baseUrl}. Check the registry URL is correct.`
      ),
    assertRegistry
  );
}

export async function fetchComponent(
  name: string,
  registry?: string
): Promise<RegistryItem> {
  const baseUrl = resolveRegistryUrl(registry);
  return await fetchJson(
    `${baseUrl}/r/${name}.json`,
    () =>
      new ComponentNotFoundError(
        `Component "${name}" not found. Run "sora list" to see available components.`
      ),
    assertRegistryItem
  );
}

/**
 * shadcn base registry items (button, dialog, ...) ship files with no
 * `target` — the shadcn CLI derives their destination from its own style
 * config. Synthesize the conventional "components/ui/<file>" target here so
 * install path resolution puts them exactly where product components'
 * "@/components/ui/..." imports expect them.
 */
function withShadcnTargets(item: RegistryItem): RegistryItem {
  return {
    ...item,
    files: item.files.map((file) =>
      file.target
        ? file
        : {
            ...file,
            target: `components/ui/${file.path.slice(file.path.lastIndexOf("/") + 1)}`,
          }
    ),
  };
}

function fetchShadcnStyleItem(
  name: string,
  style: string
): Promise<RegistryItem> {
  // Both segments end up in a URL: `name` comes from remote registry data
  // and `style` from the user's components.json — encode so neither can
  // smuggle path segments or query strings into the request.
  const url = SHADCN_REGISTRY_URL_TEMPLATE.replace(
    "{style}",
    encodeURIComponent(style)
  ).replace("{name}", encodeURIComponent(name));
  return fetchJson(
    url,
    () =>
      new ComponentNotFoundError(
        `Component "${name}" not found in the shadcn/ui base registry.`
      ),
    assertRegistryItem
  );
}

/**
 * Fetches a component from shadcn's own base registry. Bare (non-namespaced)
 * registryDependencies like "button" refer to shadcn/ui base components by
 * convention — when the product registry doesn't serve them itself, they're
 * resolved from here, mirroring how the shadcn CLI handles them. The
 * project's components.json style is honored so the fetched variant matches
 * what the shadcn CLI itself would install; an unknown style falls back to
 * the default rather than failing the whole install.
 */
export async function fetchShadcnComponent(
  name: string,
  style: string = DEFAULT_SHADCN_STYLE
): Promise<RegistryItem> {
  try {
    return withShadcnTargets(await fetchShadcnStyleItem(name, style));
  } catch (err) {
    if (
      err instanceof ComponentNotFoundError &&
      style !== DEFAULT_SHADCN_STYLE
    ) {
      return withShadcnTargets(
        await fetchShadcnStyleItem(name, DEFAULT_SHADCN_STYLE)
      );
    }
    throw err;
  }
}

export async function fetchFromUrl(url: string): Promise<RegistryItem> {
  assertSecureRegistryUrl(url);
  return await fetchJson(
    url,
    () => new ComponentNotFoundError(`Component file not found at URL: ${url}`),
    assertRegistryItem
  );
}

export function readFromLocalFile(filePath: string, cwd: string): RegistryItem {
  const resolvedPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  if (!existsSync(resolvedPath)) {
    throw new ComponentNotFoundError(
      `Local component file not found: "${filePath}" (resolved to ${resolvedPath}).`
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Local file "${filePath}" returned invalid JSON: ${(err as Error).message}`,
      { cause: err }
    );
  }
  assertRegistryItem(data);
  return data;
}

export async function fetchFromGitHub(address: {
  item: string;
  owner: string;
  ref?: string;
  repo: string;
}): Promise<RegistryItem> {
  const ref = address.ref ?? "HEAD";
  const candidates = [
    `https://raw.githubusercontent.com/${address.owner}/${address.repo}/${ref}/r/${address.item}.json`,
    `https://raw.githubusercontent.com/${address.owner}/${address.repo}/${ref}/public/r/${address.item}.json`,
    `https://raw.githubusercontent.com/${address.owner}/${address.repo}/${ref}/${address.item}.json`,
  ];
  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  let lastError: Error | null = null;
  for (const url of candidates) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: fallback URL probing
      return await fetchJson(
        url,
        () => new ComponentNotFoundError(`Not found at ${url}`),
        assertRegistryItem,
        headers
      );
    } catch (err) {
      if (err instanceof ComponentNotFoundError) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw new ComponentNotFoundError(
    `Component "${address.item}" not found in GitHub repository ${address.owner}/${address.repo}#${ref}.`,
    { cause: lastError }
  );
}

export async function fetchFromNamespace(
  namespace: string,
  item: string,
  config?: ProjectConfig,
  registryOverride?: string
): Promise<{ fromShadcn: boolean; item: RegistryItem }> {
  if (namespace === "@shadcn") {
    const fetched = await fetchShadcnComponent(item, config?.shadcnStyle);
    return { fromShadcn: true, item: fetched };
  }

  let targetUrl: string | undefined;
  if (registryOverride) {
    targetUrl = resolveRegistryUrl(registryOverride);
  } else if (config?.registries?.[namespace]) {
    targetUrl = config.registries[namespace];
  } else {
    const bareScope = namespace.replace(LEADING_AT, "");
    if (config?.registries?.[bareScope]) {
      targetUrl = config.registries[bareScope];
    } else if (REGISTRIES[bareScope]) {
      targetUrl = REGISTRIES[bareScope];
    }
  }

  if (!targetUrl) {
    throw new Error(
      `Unknown registry namespace "${namespace}". Define it in components.json under "registries" (e.g. "${namespace}": "https://..."), or pass --registry.`
    );
  }

  let url: string;
  if (targetUrl.includes("{name}")) {
    url = targetUrl.replace("{name}", encodeURIComponent(item));
    if (config?.shadcnStyle && url.includes("{style}")) {
      url = url.replace("{style}", encodeURIComponent(config.shadcnStyle));
    }
  } else {
    const base = targetUrl.replace(TRAILING_SLASH, "");
    url = base.endsWith("/r")
      ? `${base}/${item}.json`
      : `${base}/r/${item}.json`;
  }

  assertSecureRegistryUrl(url);
  const result = await fetchJson(
    url,
    () =>
      new ComponentNotFoundError(
        `Component "${item}" not found in registry ${namespace} (${url}).`
      ),
    assertRegistryItem
  );

  return { fromShadcn: url.includes("ui.shadcn.com"), item: result };
}

export async function fetchComponentByAddress(
  address: ComponentAddress,
  config?: ProjectConfig,
  registryOverride?: string
): Promise<{ fromShadcn: boolean; item: RegistryItem }> {
  switch (address.scheme) {
    case "url": {
      const item = await fetchFromUrl(address.url);
      const fromShadcn = address.url.includes("ui.shadcn.com");
      return { fromShadcn, item: fromShadcn ? withShadcnTargets(item) : item };
    }
    case "file": {
      const item = readFromLocalFile(
        address.path,
        config?.cwd ?? process.cwd()
      );
      return { fromShadcn: false, item };
    }
    case "github": {
      const item = await fetchFromGitHub(address);
      return { fromShadcn: false, item };
    }
    case "namespace": {
      return await fetchFromNamespace(
        address.namespace,
        address.item,
        config,
        registryOverride
      );
    }
    case "bare": {
      try {
        const item = await fetchComponent(address.name, registryOverride);
        return { fromShadcn: false, item };
      } catch (err) {
        if (err instanceof ComponentNotFoundError) {
          try {
            const item = await fetchShadcnComponent(
              address.name,
              config?.shadcnStyle
            );
            return { fromShadcn: true, item };
          } catch (shadcnErr) {
            throw shadcnErr instanceof ComponentNotFoundError ? err : shadcnErr;
          }
        }
        throw err;
      }
    }
    default: {
      const unreachable: never = address;
      throw new Error(
        `Unhandled address scheme: ${JSON.stringify(unreachable)}`
      );
    }
  }
}

export async function getAvailableComponents(
  registry?: string
): Promise<string[]> {
  const data = await fetchRegistry(registry);
  return data.items
    .filter(
      (item) => item.type === "registry:ui" && !item.name.startsWith("demo-")
    )
    .map((item) => item.name);
}
