import {
  DEFAULT_REGISTRY,
  DEFAULT_SHADCN_STYLE,
  REGISTRIES,
  SHADCN_REGISTRY_URL_TEMPLATE,
} from "@/constants.js";
import type { Registry, RegistryItem } from "@/types.js";
import { sanitize } from "@/utils/colors.js";

/**
 * Distinguishes "this component doesn't exist on that registry" (a 404)
 * from network/shape/server failures — tree resolution falls back to the
 * shadcn base registry only for the former, and must not mask the latter.
 */
export class ComponentNotFoundError extends Error {}

const HTTP_URL = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;
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
  validate: (data: unknown) => asserts data is T
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
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
