/**
 * Whether the app runs in Litium Cloud, behind its Fastly edge.
 *
 * Read from `process.env` at runtime rather than from `runtimeConfig`: the
 * image is built once and the platform sets `RUNNING_IN_LITIUM_CLOUD=true` on
 * the container, and only `NUXT_`-prefixed variables reach `runtimeConfig`.
 */
export function isRunningInLitiumCloud(): boolean {
  return process.env.RUNNING_IN_LITIUM_CLOUD === 'true';
}

/**
 * The first entry of a comma-separated forwarding header, trimmed. Node joins
 * a repeated header with `, `; an array (never sent for these headers, but
 * allowed by the type) is read the same way. `''` when the header is absent.
 */
export function firstForwardedEntry(
  value: string | string[] | undefined,
): string {
  const joined = Array.isArray(value) ? value.join(',') : value;
  return joined?.split(',')[0]?.trim() ?? '';
}
