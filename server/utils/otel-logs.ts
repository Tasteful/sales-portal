/**
 * OTLP log export.
 *
 * When an OTLP endpoint is configured (in Litium Cloud a collector sidecar on
 * `localhost:4318`), server logs are sent over OTLP/HTTP instead of being
 * printed to the console. `logger.ts` emits through the `'app'` scope and the
 * `00.otel-logs` plugin forwards every `console.*` call through `'console'`.
 *
 * No global provider is registered: Sentry owns the global OpenTelemetry setup.
 */

import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

/** OTLP log export is on when an endpoint is set and OTEL_LOGS_EXPORTER is not `none`. Read at call time, like LOG_LEVEL. */
export function isOtelLogExportEnabled(): boolean {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return (
    !!endpoint &&
    process.env.OTEL_LOGS_EXPORTER?.trim().toLowerCase() !== 'none'
  );
}

let provider: LoggerProvider | undefined;
let closed = false;

/** The OTel logger for a scope (`'app'` for logger.ts, `'console'` for patched console), or undefined when export is off or shut down. */
export function getOtelLogger(
  scope: 'app' | 'console',
): OtelLogger | undefined {
  if (closed || !isOtelLogExportEnabled()) return undefined;
  // The exporter reads the endpoint from OTEL_EXPORTER_OTLP_(LOGS_)ENDPOINT and appends /v1/logs itself.
  provider ??= new LoggerProvider({
    processors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
  });
  return provider.getLogger(scope);
}

/** Flushes buffered records and stops export; later calls to getOtelLogger return undefined. */
export async function shutdownOtelLogs(): Promise<void> {
  closed = true;
  const current = provider;
  provider = undefined;
  await current?.shutdown();
}
