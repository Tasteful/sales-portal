import { describe, it, expect, vi, afterEach } from 'vitest';
import { lookupHostname } from '../../../server/utils/lookup-hostname';

/**
 * Apart from `TENANT_LOOKUP_HOSTNAME`, the function reads nothing but its
 * argument — no mode, no config — so these cases are the whole contract. That
 * it stays on in a production build is proved where it can actually be
 * observed: "rewrites with dev mode off too" in
 * tests/server/plugins/02.tenant-context.test.ts.
 */

describe('lookupHostname', () => {
  it('rewrites a .litium.test host to .litium.store', () => {
    expect(lookupHostname('example.litium.test')).toBe('example.litium.store');
  });

  it('leaves a host that does not end in .litium.test untouched', () => {
    for (const hostname of [
      'example.litium.store',
      'example.sales-portal.geins.dev',
      'shop.example.com',
      'localhost',
    ]) {
      expect(lookupHostname(hostname), hostname).toBe(hostname);
    }
  });

  it('matches the suffix at the end only', () => {
    // The suffix appears, but the host belongs to someone else.
    expect(lookupHostname('litium.test.example.com')).toBe(
      'litium.test.example.com',
    );
    // The bare domain carries no tenant name to rewrite.
    expect(lookupHostname('litium.test')).toBe('litium.test');
  });

  it('swaps only the tail of a deeper name', () => {
    expect(lookupHostname('preview.example.litium.test')).toBe(
      'preview.example.litium.store',
    );
  });

  describe('with TENANT_LOOKUP_HOSTNAME set', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('looks every host up by the override', () => {
      vi.stubEnv('TENANT_LOOKUP_HOSTNAME', ' sonoralab.litium.store ');

      for (const hostname of [
        'shop.example.com',
        'other.litium.test',
        'localhost',
      ]) {
        expect(lookupHostname(hostname), hostname).toBe(
          'sonoralab.litium.store',
        );
      }
    });

    it('rewrites a .litium.test override like any other host', () => {
      vi.stubEnv('TENANT_LOOKUP_HOSTNAME', 'sonoralab.litium.test');

      expect(lookupHostname('shop.example.com')).toBe('sonoralab.litium.store');
    });

    it('ignores a blank override', () => {
      vi.stubEnv('TENANT_LOOKUP_HOSTNAME', '  ');

      expect(lookupHostname('shop.example.com')).toBe('shop.example.com');
    });
  });
});
