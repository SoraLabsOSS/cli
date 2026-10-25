import type { ComponentAddress } from "@/types.js";

const HTTP_URL = /^https?:\/\//i;
const GITHUB_PREFIX = /^github:/i;
const LOCAL_FILE_PREFIX = /^(?:\.{1,2}[/\\]|[A-Za-z]:[/\\]|\/|\\\\)/;
const JSON_EXTENSION = /\.json$/i;

const GITHUB_OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const GITHUB_REPO_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Parses a component identifier (bare name, URL, local file path, GitHub
 * specifier, or scoped namespace) into a structured ComponentAddress.
 */
export function parseComponentAddress(specifier: string): ComponentAddress {
  const trimmed = specifier.trim();

  // 1. Direct HTTP/HTTPS URL
  if (HTTP_URL.test(trimmed)) {
    return { scheme: "url", url: trimmed };
  }

  // 2. Explicit or relative local file path (.json or ./ ../ paths)
  if (LOCAL_FILE_PREFIX.test(trimmed) || JSON_EXTENSION.test(trimmed)) {
    return { path: trimmed, scheme: "file" };
  }

  // 3. GitHub specifiers (github:owner/repo/item or owner/repo/item)
  if (GITHUB_PREFIX.test(trimmed)) {
    const raw = trimmed.replace(GITHUB_PREFIX, "");
    return parseGitHubAddress(raw);
  }

  // 4. Scoped namespace (@scope/item)
  if (trimmed.startsWith("@") && trimmed.includes("/")) {
    const slashIdx = trimmed.indexOf("/");
    const namespace = trimmed.slice(0, slashIdx);
    const item = trimmed.slice(slashIdx + 1);
    return { item, namespace, scheme: "namespace" };
  }

  // 5. GitHub shorthand: owner/repo/item (at least 3 segments, not scoped)
  if (!trimmed.startsWith("@") && trimmed.split("/").length >= 3) {
    const parsedGh = tryParseGitHubShorthand(trimmed);
    if (parsedGh) {
      return parsedGh;
    }
  }

  // 6. Bare component name (e.g. "button", "text-effect")
  return { name: trimmed, scheme: "bare" };
}

function parseGitHubAddress(raw: string): ComponentAddress {
  let ref: string | undefined;
  let path = raw;

  const hashIdx = raw.indexOf("#");
  if (hashIdx !== -1) {
    path = raw.slice(0, hashIdx);
    ref = raw.slice(hashIdx + 1);
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 3) {
    const owner = parts[0] ?? "";
    const repo = parts[1] ?? "";
    const item = parts.slice(2).join("/");
    return { item, owner, ref, repo, scheme: "github" };
  }

  // If malformed, treat as bare
  return { name: raw, scheme: "bare" };
}

function tryParseGitHubShorthand(specifier: string): ComponentAddress | null {
  let ref: string | undefined;
  let path = specifier;

  const hashIdx = specifier.indexOf("#");
  if (hashIdx !== -1) {
    path = specifier.slice(0, hashIdx);
    ref = specifier.slice(hashIdx + 1);
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const owner = parts[0] ?? "";
  const repo = parts[1] ?? "";
  if (!(GITHUB_OWNER_PATTERN.test(owner) && GITHUB_REPO_PATTERN.test(repo))) {
    return null;
  }

  const item = parts.slice(2).join("/");
  if (!item) {
    return null;
  }

  return { item, owner, ref, repo, scheme: "github" };
}

export function formatAddress(address: ComponentAddress): string {
  switch (address.scheme) {
    case "url":
      return address.url;
    case "file":
      return address.path;
    case "github": {
      const refSuffix = address.ref ? `#${address.ref}` : "";
      return `${address.owner}/${address.repo}/${address.item}${refSuffix}`;
    }
    case "namespace":
      return `${address.namespace}/${address.item}`;
    case "bare":
      return address.name;
    default: {
      const unreachable: never = address;
      throw new Error(
        `Unhandled address scheme: ${JSON.stringify(unreachable)}`
      );
    }
  }
}

export function addressKey(address: ComponentAddress): string {
  switch (address.scheme) {
    case "url":
      return `url:${address.url}`;
    case "file":
      return `file:${address.path}`;
    case "github":
      return `gh:${address.owner}/${address.repo}/${address.item}#${address.ref ?? ""}`;
    case "namespace":
      return `ns:${address.namespace}/${address.item}`;
    case "bare":
      return `bare:${address.name}`;
    default: {
      const unreachable: never = address;
      throw new Error(
        `Unhandled address scheme: ${JSON.stringify(unreachable)}`
      );
    }
  }
}
