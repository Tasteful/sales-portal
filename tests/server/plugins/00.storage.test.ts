import { describe, it, expect, vi, beforeEach } from 'vitest';

// The plugin reaches useRuntimeConfig/useStorage as auto-imports, which only
// these module mocks intercept in the node tier (as in tests/server/tenant.test.ts).
const {
  mount,
  redisDriver,
  warn,
  storageConfig,
  mockUseRuntimeConfig,
  mockUseStorage,
} = vi.hoisted(() => {
  const storageConfig = { current: {} as Record<string, string> };
  const mount = vi.fn();
  return {
    mount,
    redisDriver: vi.fn((options: unknown) => ({ name: 'redis', options })),
    warn: vi.fn(),
    storageConfig,
    mockUseRuntimeConfig: vi.fn(() => ({ storage: storageConfig.current })),
    mockUseStorage: vi.fn(() => ({ mount })),
  };
});

vi.mock('#imports', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useRuntimeConfig: mockUseRuntimeConfig,
    useStorage: mockUseStorage,
  };
});
vi.mock('#app/nuxt', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useRuntimeConfig: mockUseRuntimeConfig };
});
vi.mock('nitropack/runtime/internal/config', async (importOriginal) => {
  const actual = (await importOriginal().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { ...actual, useRuntimeConfig: mockUseRuntimeConfig };
});
vi.mock('nitropack/runtime/internal/storage', async (importOriginal) => {
  const actual = (await importOriginal().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { ...actual, useStorage: mockUseStorage };
});
vi.mock('unstorage/drivers/redis', () => ({ default: redisDriver }));
vi.mock('../../../server/utils/logger', () => ({
  logger: { warn, info: vi.fn() },
}));

vi.stubGlobal('defineNitroPlugin', (fn: () => void) => fn);
vi.stubGlobal('useStorage', mockUseStorage);

/** Loads the plugin and runs it once, as Nitro does at startup. */
async function runPlugin(storage: Record<string, string>) {
  storageConfig.current = storage;
  vi.resetModules();
  const plugin = (await import('../../../server/plugins/00.storage'))
    .default as unknown as () => void;
  plugin();
}

describe('00.storage', () => {
  beforeEach(() => {
    mount.mockClear();
    redisDriver.mockClear();
    warn.mockClear();
  });

  it('should leave kv in memory for any driver but redis', async () => {
    await runPlugin({
      driver: 'memory',
      redisUrl: 'redis://cache:6379',
      redisPassword: '',
    });

    expect(mount).not.toHaveBeenCalled();
  });

  it('should leave kv in memory and warn when redis has no connection string', async () => {
    await runPlugin({ driver: 'redis', redisUrl: '', redisPassword: 'p' });

    expect(mount).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('should mount kv on Sentinel Redis from the Litium Cloud string and password, under the app prefix', async () => {
    await runPlugin({
      driver: 'redis',
      redisUrl: 'node-0:26379,node-1:26379,serviceName=mymaster',
      redisPassword: 's3cret',
    });

    expect(mount).toHaveBeenCalledOnce();
    expect(mount.mock.calls[0]![0]).toBe('kv');
    expect(redisDriver).toHaveBeenCalledWith({
      name: 'mymaster',
      sentinels: [
        { host: 'node-0', port: 26379 },
        { host: 'node-1', port: 26379 },
      ],
      password: 's3cret',
      sentinelPassword: 's3cret',
      base: 'sales-portal',
    });
  });

  it('should mount kv on Redis from a URL', async () => {
    await runPlugin({
      driver: 'redis',
      redisUrl: 'rediss://default:pw@host.upstash.io:6379',
      redisPassword: '',
    });

    expect(redisDriver).toHaveBeenCalledWith({
      url: 'rediss://default:pw@host.upstash.io:6379',
      base: 'sales-portal',
    });
  });

  it('should refuse to start on an invalid connection string', async () => {
    await expect(
      runPlugin({
        driver: 'redis',
        redisUrl: 'a:6379,b:6379',
        redisPassword: '',
      }),
    ).rejects.toThrow(/no serviceName/);
    expect(mount).not.toHaveBeenCalled();
  });
});
