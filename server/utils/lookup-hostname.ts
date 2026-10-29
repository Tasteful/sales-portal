/**
 * The local hostname suffix. `pnpm local:setup` installs a dnsmasq wildcard
 * sending all of `*.litium.test` to 127.0.0.1, so any name under it reaches a
 * local server without an `/etc/hosts` line.
 */
const LOCAL_SUFFIX = '.litium.test';

/** The suffix a tenant is actually registered under in the merchant API. */
const LOOKUP_SUFFIX = '.litium.store';

/**
 * `TENANT_LOOKUP_HOSTNAME`, trimmed, or `undefined` when unset or blank.
 *
 * A testing aid: when set, every request looks its tenant up by this name,
 * whatever host it arrived on, so any number of hostnames (and `localhost`)
 * all serve the same store. Read at runtime so a built image honours it.
 */
export function lookupHostnameOverride(): string | undefined {
  return process.env.TENANT_LOOKUP_HOSTNAME?.trim() || undefined;
}

/**
 * The hostname to look the tenant up by, which is not always the hostname the
 * browser asked for.
 *
 * `TENANT_LOOKUP_HOSTNAME` (see {@link lookupHostnameOverride}) replaces the
 * request's hostname outright when it is set; the suffix rewrite below then
 * applies to whichever name is used.
 *
 * The merchant API only knows a tenant's real hostnames, so a developer who
 * types `name.litium.test` would get a 404 for every tenant that does not also
 * carry a `.litium.test` alias in Geins. The lookup is therefore rewritten to
 * `name.litium.store`, which is where a Geins tenant lives by default — so any
 * registered tenant can be browsed by name alone, with nothing to configure.
 *
 * This applies in every mode, the production build included, because the
 * production build is what CI and `E2E_PROD=1` test and they need the same
 * name to work. RFC 6761 reserves `.test` for exactly this: it is never
 * delegated, so a name under it cannot be resolved from the public internet
 * and no deployed environment can ever receive one. The rewrite is therefore
 * unreachable in production while being identical in the build under test —
 * which is the point.
 *
 * The one behaviour it takes away: a tenant that registers `X.litium.test` as
 * an alias in Geins is no longer reachable under that exact name, since the
 * lookup resolves `X.litium.store` instead. Only local and CI traffic can
 * carry such a name, and an unknown one still answers an honest 404.
 *
 * Only the lookup moves. The response is still served under the host the
 * browser asked for: `event.context.tenant.hostname` keeps that name, so
 * cookies, redirects, the tenant logger and the 404 body all stay on it.
 */
export function lookupHostname(hostname: string): string {
  const host = lookupHostnameOverride() ?? hostname;
  if (!host.endsWith(LOCAL_SUFFIX)) return host;
  return host.slice(0, -LOCAL_SUFFIX.length) + LOOKUP_SUFFIX;
}
