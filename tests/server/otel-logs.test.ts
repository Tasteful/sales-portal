import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';

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

/** The provider is a module singleton, so each case loads fresh modules after setting env. */
async function load() {
  vi.resetModules();
  const loggerModule = await import('../../server/utils/logger');
  const otelModule = await import('../../server/utils/otel-logs');
  return { ...loggerModule, ...otelModule };
}

describe('OTLP log export', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', '');
    vi.stubEnv('OTEL_LOGS_EXPORTER', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    exported.length = 0;
  });

  it('should print to the console when no endpoint is set', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createLogger, shutdownOtelLogs } = await load();

    createLogger().info('hello');
    await shutdownOtelLogs();

    expect(log).toHaveBeenCalledOnce();
    expect(exported).toHaveLength(0);
  });

  it('should export an error entry with context, exception and severity', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createLogger, shutdownOtelLogs } = await load();

    createLogger({ tenantId: 't1' }).error('Failed', new TypeError('boom'), {
      statusCode: 502,
      details: { a: 1 },
      cause: new Error('inner'),
    });
    await shutdownOtelLogs();

    expect(exported).toHaveLength(1);
    const [record] = exported;
    expect(record!.severityNumber).toBe(17);
    expect(record!.severityText).toBe('ERROR');
    expect(record!.body).toBe('Failed');
    expect(record!.instrumentationScope.name).toBe('app');
    expect(record!.attributes).toMatchObject({
      tenantId: 't1',
      statusCode: 502,
      details: '{"a":1}',
      cause: 'Error: inner',
      'exception.type': 'TypeError',
      'exception.message': 'boom',
    });
    expect(record!.attributes['exception.stacktrace']).toContain('boom');
    expect(error).not.toHaveBeenCalled();
  });

  it('should print to the console when OTEL_LOGS_EXPORTER is none', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    vi.stubEnv('OTEL_LOGS_EXPORTER', ' None ');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createLogger, shutdownOtelLogs } = await load();

    createLogger().info('hello');
    await shutdownOtelLogs();

    expect(log).toHaveBeenCalledOnce();
    expect(exported).toHaveLength(0);
  });

  it('should export when only the logs-specific endpoint is set', async () => {
    vi.stubEnv(
      'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
      'http://localhost:4318/v1/logs',
    );
    const { createLogger, shutdownOtelLogs } = await load();

    createLogger().info('hello');
    await shutdownOtelLogs();

    expect(exported.map((r) => r.body)).toEqual(['hello']);
  });

  it('should still apply LOG_LEVEL before exporting', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    vi.stubEnv('LOG_LEVEL', 'warn');
    const { createLogger, shutdownOtelLogs } = await load();

    const logger = createLogger();
    logger.info('skipped');
    logger.warn('kept');
    await shutdownOtelLogs();

    expect(exported.map((r) => [r.body, r.severityText])).toEqual([
      ['kept', 'WARN'],
    ]);
  });

  it('should fall back to the console after shutdown', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { createLogger, shutdownOtelLogs } = await load();

    await shutdownOtelLogs();
    createLogger().info('late');

    expect(log).toHaveBeenCalledOnce();
    expect(exported).toHaveLength(0);
  });
});
