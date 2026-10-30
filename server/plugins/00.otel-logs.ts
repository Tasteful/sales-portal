import util from 'node:util';
import {
  SeverityNumber,
  type LogAttributes,
  type Logger as OtelLogger,
} from '@opentelemetry/api-logs';
import { getOtelLogger, shutdownOtelLogs } from '../utils/otel-logs';

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'log' | 'warn' | 'error';

const CONSOLE_SEVERITY: Record<ConsoleMethod, [SeverityNumber, string]> = {
  trace: [SeverityNumber.TRACE, 'TRACE'],
  debug: [SeverityNumber.DEBUG, 'DEBUG'],
  info: [SeverityNumber.INFO, 'INFO'],
  log: [SeverityNumber.INFO, 'INFO'],
  warn: [SeverityNumber.WARN, 'WARN'],
  error: [SeverityNumber.ERROR, 'ERROR'],
};

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === 'object' && arg !== null
        ? util.inspect(arg, { depth: 5, colors: false })
        : util.stripVTControlCharacters(String(arg)),
    )
    .join(' ');
}

function exceptionAttributes(args: unknown[]): LogAttributes {
  const error = args.find((arg): arg is Error => arg instanceof Error);
  if (!error) return {};
  const attributes: LogAttributes = {
    'exception.type': error.name,
    'exception.message': error.message,
  };
  if (error.stack) attributes['exception.stacktrace'] = error.stack;
  return attributes;
}

function forward(
  logger: OtelLogger,
  severityNumber: SeverityNumber,
  severityText: string,
) {
  return (...args: unknown[]): void => {
    logger.emit({
      severityNumber,
      severityText,
      body: formatArgs(args),
      attributes: exceptionAttributes(args),
    });
  };
}

/**
 * When OTLP log export is on (see `utils/otel-logs.ts`), every `console.*`
 * call, ours and our dependencies' (Nuxt, Sentry, ...), is sent over OTLP
 * instead of being printed. `process.stdout`/`stderr` are left alone, so
 * Nitro's startup line and early crashes still reach the container console.
 *
 * On `close` (SIGTERM/SIGINT) the console is restored and pending records are
 * flushed before the process exits.
 */
export default defineNitroPlugin((nitroApp) => {
  const consoleLogger = getOtelLogger('console');
  if (!consoleLogger) return;

  const methods = Object.keys(CONSOLE_SEVERITY) as ConsoleMethod[];
  const originals = new Map(methods.map((m) => [m, console[m]] as const));

  for (const method of methods) {
    const [severityNumber, severityText] = CONSOLE_SEVERITY[method];
    console[method] = forward(consoleLogger, severityNumber, severityText);
  }

  nitroApp.hooks.hook('close', async () => {
    for (const [method, original] of originals) console[method] = original;
    await shutdownOtelLogs();
  });
});
