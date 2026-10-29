import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';

type RequestHook = (event: unknown) => void;

vi.stubGlobal(
  'defineNitroPlugin',
  (fn: (nitroApp: unknown) => void): Record<string, RequestHook> => {
    const hooks: Record<string, RequestHook> = {};
    fn({
      hooks: {
        hook: (name: string, cb: RequestHook) => {
          hooks[name] = cb;
        },
      },
    });
    return hooks;
  },
);

/** The plugin decides at load whether to register, so each case loads it anew. */
async function loadRequestHook(): Promise<RequestHook | undefined> {
  vi.resetModules();
  const hooks = (await import('../../../server/plugins/00.litium-cloud-proxy'))
    .default as unknown as Record<string, RequestHook>;
  return hooks.request;
}

function run(hook: RequestHook, headers: IncomingHttpHeaders) {
  hook({ node: { req: { headers } } });
  return headers;
}

describe('00.litium-cloud-proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('in Litium Cloud', () => {
    let hook: RequestHook;

    beforeEach(async () => {
      vi.stubEnv('RUNNING_IN_LITIUM_CLOUD', 'true');
      hook = (await loadRequestHook())!;
    });

    it('should take the host from the first X-Forwarded-Host entry', () => {
      const headers = run(hook, {
        host: 'app.internal:3000',
        'x-forwarded-host': ' shop.example.com , other.example.com',
      });

      expect(headers.host).toBe('shop.example.com');
    });

    it('should always report https', () => {
      const headers = run(hook, {
        host: 'app.internal',
        'x-forwarded-host': 'shop.example.com',
        'x-forwarded-proto': 'http',
      });

      expect(headers['x-forwarded-proto']).toBe('https');
    });

    it('should keep Host when X-Forwarded-Host is absent or empty', () => {
      expect(run(hook, { host: 'shop.example.com' }).host).toBe(
        'shop.example.com',
      );
      expect(
        run(hook, { host: 'shop.example.com', 'x-forwarded-host': ' ' }).host,
      ).toBe('shop.example.com');
    });
  });

  it('should not register outside Litium Cloud', async () => {
    vi.stubEnv('RUNNING_IN_LITIUM_CLOUD', 'false');

    expect(await loadRequestHook()).toBeUndefined();
  });
});
