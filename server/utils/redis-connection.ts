/**
 * Redis connection strings to unstorage redis driver (ioredis) options.
 *
 * Two formats are accepted:
 *
 * - A URL, `redis://[[user]:password@]host[:port][/db]` or `rediss://` for TLS
 *   (Azure, Upstash). Passed through as `url`.
 * - The StackExchange.Redis (.NET) format Litium Cloud injects, a comma list of
 *   endpoints and `key=value` options:
 *   `node-0:26379,node-1:26379,serviceName=mymaster`. With `serviceName` the
 *   endpoints are Sentinels and ioredis asks them for the current master.
 *
 * Litium Cloud injects the password separately; pass it as `password`.
 */

import type { RedisOptions } from 'unstorage/drivers/redis';

const REDIS_PORT = 6379;
const SENTINEL_PORT = 26379;

interface Endpoint {
  host: string;
  port?: number;
}

/** `host`, `host:port`, `[ipv6]` or `[ipv6]:port`. */
function parseEndpoint(value: string): Endpoint {
  const match = /^(?:\[([^\]]+)\]|([^:]+))(?::(.*))?$/.exec(value);
  const host = match?.[1] ?? match?.[2];
  if (!host) throw new Error(`Invalid Redis endpoint "${value}"`);
  if (match?.[3] === undefined) return { host };

  const port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in Redis endpoint "${value}"`);
  }
  return { host, port };
}

/**
 * Parse a Redis connection string into options for the unstorage redis driver.
 *
 * In the .NET format, a separately given `password` wins over `password=` in
 * the string, and the same password authenticates against the Sentinels, as
 * StackExchange.Redis does. For a URL, a password in the URL wins (ioredis
 * precedence); the separate one applies when the URL has none.
 *
 * Recognized .NET options: `serviceName`, `password`, `user`, `ssl`,
 * `defaultDatabase` (keys are case-insensitive). Others (`abortConnect`,
 * `connectTimeout`, ...) are .NET client tuning and are ignored.
 *
 * Throws on a string with no endpoint, a bad port, or several endpoints
 * without `serviceName` (ioredis connects to one server or to Sentinels).
 * Error messages never contain the password.
 */
export function parseRedisConnectionString(
  value: string,
  password?: string,
): RedisOptions {
  const connection = value.trim();
  const separatePassword = password || undefined;

  if (/^rediss?:\/\//i.test(connection)) {
    return separatePassword
      ? { url: connection, password: separatePassword }
      : { url: connection };
  }

  const endpoints: Endpoint[] = [];
  const settings = new Map<string, string>();
  for (const part of connection.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.indexOf('=');
    if (eq < 0) endpoints.push(parseEndpoint(token));
    else
      settings.set(
        token.slice(0, eq).trim().toLowerCase(),
        token.slice(eq + 1).trim(),
      );
  }

  if (endpoints.length === 0) {
    throw new Error('Redis connection string has no endpoint');
  }

  const options: RedisOptions = {};
  const resolvedPassword =
    separatePassword ?? (settings.get('password') || undefined);
  if (resolvedPassword) options.password = resolvedPassword;

  const user = settings.get('user');
  if (user) options.username = user;

  const db = settings.get('defaultdatabase');
  if (db) {
    const index = Number(db);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(
        `Invalid defaultDatabase "${db}" in Redis connection string`,
      );
    }
    options.db = index;
  }

  const tls = settings.get('ssl')?.toLowerCase() === 'true';
  const serviceName = settings.get('servicename');

  if (serviceName) {
    options.name = serviceName;
    options.sentinels = endpoints.map(({ host, port }) => ({
      host,
      port: port ?? SENTINEL_PORT,
    }));
    if (resolvedPassword) options.sentinelPassword = resolvedPassword;
    if (user) options.sentinelUsername = user;
    if (tls) {
      options.sentinelTLS = {};
      options.tls = {};
      options.enableTLSForSentinelMode = true;
    }
    return options;
  }

  if (endpoints.length > 1) {
    throw new Error(
      'Redis connection string lists several endpoints but no serviceName; only Sentinel mode supports several',
    );
  }

  const [endpoint] = endpoints as [Endpoint];
  options.host = endpoint.host;
  options.port = endpoint.port ?? REDIS_PORT;
  if (tls) options.tls = {};
  return options;
}
