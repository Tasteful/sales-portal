import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';

type Hook = () => Promise<void> | void;

const exported = vi.hoisted(() => [] as ReadableLogRecord[]);

// The real SDK and batch processor run; only the network hop is replaced.
vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: class {
    export(
      records: ReadableLogRecord[],
      cb: (result: { code: number }) => void,
    ) {
      exported.push(...records);
      cb({ code: 0 });
    }
    shutdown() {
      return Promise.resolve();
    }
    forceFlush() {
      return Promise.resolve();
    }
  },
}));

vi.stubGlobal(
  'defineNitroPlugin',
  (fn: (nitroApp: unknown) => void): Record<string, Hook> => {
    const hooks: Record<string, Hook> = {};
    fn({
      hooks: {
        hook: (name: string, cb: Hook) => {
          hooks[name] = cb;
        },
      },
    });
    return hooks;
  },
);

/** The plugin and the provider singleton are set up at load, so each case loads them anew. */
async function loadPlugin() {
  vi.resetModules();
  const hooks = (await import('../../../server/plugins/00.otel-logs'))
    .default as unknown as Record<string, Hook>;
  const { shutdownOtelLogs } = await import('../../../server/utils/otel-logs');
  return { hooks, shutdownOtelLogs };
}

const CONSOLE_METHODS = [
  'trace',
  'debug',
  'info',
  'log',
  'warn',
  'error',
] as const;

describe('00.otel-logs', () => {
  const saved = new Map(CONSOLE_METHODS.map((m) => [m, console[m]] as const));

  beforeEach(() => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', '');
    vi.stubEnv('OTEL_LOGS_EXPORTER', '');
  });

  afterEach(() => {
    for (const [method, original] of saved) console[method] = original;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    exported.length = 0;
  });

  it('should leave the console alone when no endpoint is set', async () => {
    const before = console.log;

    const { hooks } = await loadPlugin();

    expect(console.log).toBe(before);
    expect(hooks.close).toBeUndefined();
  });

  describe('with an endpoint', () => {
    beforeEach(() => {
      vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    });

    it('should export console calls instead of printing them', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { shutdownOtelLogs } = await loadPlugin();

      console.warn('\x1b[31mred\x1b[0m', { a: 1 });
      await shutdownOtelLogs();

      expect(exported).toHaveLength(1);
      const [record] = exported;
      expect(record!.instrumentationScope.name).toBe('console');
      expect(record!.severityText).toBe('WARN');
      expect(record!.body).toBe('red { a: 1 }');
      expect(warn).not.toHaveBeenCalled();
    });

    it('should map an Error argument to exception attributes', async () => {
      const { shutdownOtelLogs } = await loadPlugin();

      console.error(new RangeError('bad'));
      await shutdownOtelLogs();

      expect(exported[0]!.attributes).toMatchObject({
        'exception.type': 'RangeError',
        'exception.message': 'bad',
      });
    });

    it('should restore the console and flush pending records on close', async () => {
      const original = console.log;
      const { hooks } = await loadPlugin();

      console.log('pending');
      expect(console.log).not.toBe(original);
      await hooks.close!();

      expect(console.log).toBe(original);
      expect(exported.map((r) => r.body)).toEqual(['pending']);
    });
  });
});
