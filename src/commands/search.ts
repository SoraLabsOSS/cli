import { done, highlight, sanitize } from "@/utils/colors.js";
import { fetchRegistry } from "@/utils/registry.js";
import { spinner } from "@/utils/spinner.js";

export interface SearchOptions {
  json?: boolean;
  limit?: number;
  query?: string;
  registry?: string;
  type?: string;
}

/**
 * Searches components in the target registry by keyword or item type.
 */
export async function search(options: SearchOptions): Promise<boolean> {
  const loadingSpinner = options.json ? null : spinner();
  loadingSpinner?.start("Fetching registry...");

  let data: Awaited<ReturnType<typeof fetchRegistry>>;
  try {
    data = await fetchRegistry(options.registry);
  } catch (err) {
    loadingSpinner?.error("Failed to fetch registry");
    throw err;
  }
  loadingSpinner?.stop("Fetched registry");

  const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
  const normalizedType = options.type?.trim().toLowerCase();

  const matches = data.items.filter((item) => {
    // Exclude demo items by default unless explicitly searching for them
    if (
      !(normalizedType || normalizedQuery.includes("demo")) &&
      item.name.startsWith("demo-")
    ) {
      return false;
    }

    if (normalizedType) {
      const itemType = item.type.toLowerCase();
      const typeMatches =
        itemType === normalizedType ||
        itemType === `registry:${normalizedType}`;
      if (!typeMatches) {
        return false;
      }
    }

    if (normalizedQuery) {
      const matchName = item.name.toLowerCase().includes(normalizedQuery);
      const matchTitle = (item.title ?? "")
        .toLowerCase()
        .includes(normalizedQuery);
      const matchDesc = (item.description ?? "")
        .toLowerCase()
        .includes(normalizedQuery);
      return matchName || matchTitle || matchDesc;
    }

    return true;
  });

  const limit = options.limit && options.limit > 0 ? options.limit : 20;
  const sliced = matches.slice(0, limit);

  if (options.json) {
    console.log(JSON.stringify(sliced, null, 2));
    return true;
  }

  if (matches.length === 0) {
    const filterDesc = normalizedQuery ? ` matching "${normalizedQuery}"` : "";
    done(`No components found${filterDesc}.`);
    return true;
  }

  const querySuffix = normalizedQuery
    ? ` for "${sanitize(normalizedQuery)}"`
    : "";
  done(
    `Found ${matches.length} component${matches.length === 1 ? "" : "s"}${querySuffix}:`
  );
  console.log();

  for (const item of sliced) {
    const typeLabel = item.type ? ` [${item.type}]` : "";
    const description = item.description
      ? ` — ${sanitize(item.description)}`
      : "";
    console.log(
      `  ${highlight(sanitize(item.name))}${typeLabel}${description}`
    );
  }

  if (matches.length > limit) {
    console.log();
    console.log(
      `  Showing top ${limit} of ${matches.length} results. Use --limit to display more.`
    );
  }

  return true;
}
