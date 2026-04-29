// Port of: lyric-test/modules/background/utils.js

/**
 * Safely traverses a nested object via a path array.
 * Returns null (or undefined if noneIfAbsent=false) if any segment is missing.
 */
export function nav(obj: unknown, path: string[], noneIfAbsent = true): unknown {
  let current = obj;
  for (const key of path) {
    if (current && typeof current === 'object' && key in (current as object)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return noneIfAbsent ? null : undefined;
    }
  }
  return current;
}

/**
 * fetch() wrapper that aborts after a configurable timeout.
 */
export async function fetchWithTimeout(
  resource: string,
  options: RequestInit = {},
  timeout = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}
