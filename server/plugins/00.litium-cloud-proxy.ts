import {
  firstForwardedEntry,
  isRunningInLitiumCloud,
} from '../utils/litium-cloud';

/**
 * In Litium Cloud every request reaches the app through Fastly, which sets
 * `X-Forwarded-Host` to the domain the shopper asked for and terminates TLS;
 * the `Host` that arrives here names the hop in between. This rewrites the
 * request once, before every other `request` hook, so everything downstream
 * sees the shopper's view: the tenant lookup in `02.tenant-context`,
 * `getRequestURL`/`useRequestURL` during SSR, and the `host` header forwarded
 * across internal SSR hops. The protocol is always https behind Fastly.
 *
 * Outside Litium Cloud nothing is touched: there `X-Forwarded-Host` is
 * whatever the client sent, and it must never choose the tenant.
 */
export default defineNitroPlugin((nitroApp) => {
  if (!isRunningInLitiumCloud()) return;

  nitroApp.hooks.hook('request', (event) => {
    const headers = event.node.req.headers;
    const host = firstForwardedEntry(headers['x-forwarded-host']);
    // An internal SSR hop may carry only the already rewritten `host`.
    if (host) headers.host = host;
    headers['x-forwarded-proto'] = 'https';
  });
});
