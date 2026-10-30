import { describe, it, expect } from 'vitest';
import { parseRedisConnectionString } from '../../server/utils/redis-connection';

describe('parseRedisConnectionString', () => {
  describe('Litium Cloud Sentinel format', () => {
    it('should turn the endpoints into Sentinels of the named master, with the separate password on both', () => {
      expect(
        parseRedisConnectionString(
          'redis-node-0.redis-headless:26379, redis-node-1.redis-headless:26380 ,serviceName=mymaster',
          's3cret',
        ),
      ).toEqual({
        name: 'mymaster',
        sentinels: [
          { host: 'redis-node-0.redis-headless', port: 26379 },
          { host: 'redis-node-1.redis-headless', port: 26380 },
        ],
        password: 's3cret',
        sentinelPassword: 's3cret',
      });
    });

    it('should default a Sentinel without a port to 26379', () => {
      expect(
        parseRedisConnectionString('sentinel-a,serviceName=mymaster').sentinels,
      ).toEqual([{ host: 'sentinel-a', port: 26379 }]);
    });

    it('should let the separate password win over one in the string', () => {
      const options = parseRedisConnectionString(
        'a:26379,serviceName=m,password=old',
        'new',
      );

      expect(options.password).toBe('new');
      expect(options.sentinelPassword).toBe('new');
    });

    it('should use the password in the string when none is given separately', () => {
      const options = parseRedisConnectionString(
        'a:26379,serviceName=m,password=inline',
        '',
      );

      expect(options.password).toBe('inline');
      expect(options.sentinelPassword).toBe('inline');
    });

    it('should set no password when there is none', () => {
      const options = parseRedisConnectionString('a:26379,serviceName=m');

      expect(options).not.toHaveProperty('password');
      expect(options).not.toHaveProperty('sentinelPassword');
    });

    it('should read option keys case-insensitively and map user, ssl and defaultDatabase', () => {
      expect(
        parseRedisConnectionString(
          'a:26379,SERVICENAME=m,User=app,SSL=True,DefaultDatabase=2,abortConnect=false',
          'p',
        ),
      ).toEqual({
        name: 'm',
        sentinels: [{ host: 'a', port: 26379 }],
        password: 'p',
        sentinelPassword: 'p',
        username: 'app',
        sentinelUsername: 'app',
        db: 2,
        tls: {},
        sentinelTLS: {},
        enableTLSForSentinelMode: true,
      });
    });

    it('should keep the colons of a bracketed IPv6 endpoint in the host', () => {
      expect(
        parseRedisConnectionString('[fd00::1]:26379,serviceName=m').sentinels,
      ).toEqual([{ host: 'fd00::1', port: 26379 }]);
    });
  });

  describe('single server in the .NET format', () => {
    it('should connect to the one endpoint, defaulting to port 6379', () => {
      expect(parseRedisConnectionString('cache.internal', 'p')).toEqual({
        host: 'cache.internal',
        port: 6379,
        password: 'p',
      });
    });

    it('should use TLS when ssl=true', () => {
      expect(parseRedisConnectionString('cache:6380,ssl=true')).toEqual({
        host: 'cache',
        port: 6380,
        tls: {},
      });
    });

    it('should refuse several endpoints without serviceName', () => {
      expect(() => parseRedisConnectionString('a:6379,b:6379')).toThrow(
        /no serviceName/,
      );
    });
  });

  describe('URL format', () => {
    it('should pass a redis:// or rediss:// URL through', () => {
      expect(
        parseRedisConnectionString('rediss://default:pw@host.upstash.io:6379'),
      ).toEqual({ url: 'rediss://default:pw@host.upstash.io:6379' });
      expect(parseRedisConnectionString(' REDIS://host ')).toEqual({
        url: 'REDIS://host',
      });
    });

    it('should add the separate password next to the URL', () => {
      expect(parseRedisConnectionString('redis://host:6379', 'p')).toEqual({
        url: 'redis://host:6379',
        password: 'p',
      });
    });
  });

  describe('invalid input', () => {
    it.each([
      ['an empty string', ''],
      ['options only', 'serviceName=m,password=p'],
    ])('should refuse %s', (_, value) => {
      expect(() => parseRedisConnectionString(value)).toThrow(/no endpoint/);
    });

    it.each(['a:0', 'a:65536', 'a:', 'a:port'])(
      'should refuse the bad port in %s',
      (value) => {
        expect(() => parseRedisConnectionString(value)).toThrow(/Invalid port/);
      },
    );

    it('should refuse a non-numeric defaultDatabase', () => {
      expect(() => parseRedisConnectionString('a,defaultDatabase=x')).toThrow(
        /defaultDatabase/,
      );
    });

    it.each([
      'a:1,b:2,password=hunter2',
      'a:bad,password=hunter2',
      'a,defaultDatabase=x,password=hunter2',
      'password=hunter2',
    ])('should keep the password out of the error for %s', (value) => {
      let message = '';
      try {
        parseRedisConnectionString(value, 'hunter2');
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).not.toBe('');
      expect(message).not.toContain('hunter2');
    });
  });
});
