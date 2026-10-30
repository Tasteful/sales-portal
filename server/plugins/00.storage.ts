import redisDriver from 'unstorage/drivers/redis';
import { logger } from '../utils/logger';
import { parseRedisConnectionString } from '../utils/redis-connection';

/**
 * Prefix of every key the app writes to Redis. The Redis of an environment can
 * be shared with other apps (in Litium Cloud every app of the environment may
 * use it), so `keys()` and `clear()` on `kv` must never reach beyond this.
 */
const KV_REDIS_BASE = 'sales-portal';

/**
 * Mounts `kv` on Redis when `NUXT_STORAGE_DRIVER=redis` and a connection string
 * is set (`NUXT_STORAGE_REDIS_URL`, password in `NUXT_STORAGE_REDIS_PASSWORD`
 * or the URL). Any other driver keeps `kv` on the root memory driver, per
 * instance. Runs before the other plugins, so no request reaches `kv` first.
 *
 * An invalid connection string throws and stops the server from starting:
 * a misconfigured shared store should not silently fall back to memory.
 */
export default defineNitroPlugin(() => {
  const { storage } = useRuntimeConfig();
  if (storage.driver !== 'redis') return;

  if (!storage.redisUrl) {
    logger.warn(
      'NUXT_STORAGE_DRIVER is redis but NUXT_STORAGE_REDIS_URL is empty; KV storage stays in memory',
    );
    return;
  }

  const options = parseRedisConnectionString(
    storage.redisUrl,
    storage.redisPassword,
  );
  useStorage().mount('kv', redisDriver({ ...options, base: KV_REDIS_BASE }));

  logger.info('KV storage on Redis', {
    mode: options.sentinels ? 'sentinel' : 'standalone',
    ...(options.name && { sentinelMaster: options.name }),
    endpoints: options.url
      ? new URL(options.url).host
      : options.sentinels
        ? options.sentinels.map((s) => `${s.host}:${s.port}`).join(',')
        : `${options.host}:${options.port}`,
  });
});
