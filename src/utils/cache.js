const Redis = require('ioredis');

// In-memory fallback cache if Redis is not running or unreachable
const memoryStore = new Map();

let redisClient = null;
let isRedisConnected = false;

// Attempt Redis connection if REDIS_URL or standard config is present
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

try {
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => {
      // Retry up to 3 times on boot, then fall back silently to in-memory cache
      if (times > 3) return null;
      return Math.min(times * 100, 1000);
    },
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  redisClient.connect().then(() => {
    isRedisConnected = true;
    console.log('⚡ Redis Cache Connected successfully:', redisUrl);
  }).catch(() => {
    isRedisConnected = false;
    console.log('ℹ️ Redis not running locally. Using High-Speed In-Memory Cache fallback.');
  });

  redisClient.on('error', () => {
    isRedisConnected = false;
  });

  redisClient.on('connect', () => {
    isRedisConnected = true;
  });
} catch (e) {
  isRedisConnected = false;
  console.log('ℹ️ Redis initialization fallback to In-Memory Cache.');
}

// Universal Cache Service (Redis with In-Memory fallback)
const cache = {
  async get(key) {
    try {
      if (isRedisConnected && redisClient) {
        const val = await redisClient.get(key);
        return val ? JSON.parse(val) : null;
      }
    } catch {
      // Fall through to memoryStore
    }

    // In-memory lookup
    const entry = memoryStore.get(key);
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      memoryStore.delete(key);
      return null;
    }

    return entry.value;
  },

  async set(key, value, ttlSeconds = 60) {
    try {
      if (isRedisConnected && redisClient) {
        await redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        return;
      }
    } catch {
      // Fall through to memoryStore
    }

    // In-memory set
    memoryStore.set(key, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  },

  async del(key) {
    try {
      if (isRedisConnected && redisClient) {
        await redisClient.del(key);
      }
    } catch {}
    memoryStore.delete(key);
  },

  async delPattern(prefix) {
    try {
      if (isRedisConnected && redisClient) {
        const keys = await redisClient.keys(`${prefix}*`);
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
      }
    } catch {}

    // In-memory pattern delete
    for (const k of memoryStore.keys()) {
      if (k.startsWith(prefix)) {
        memoryStore.delete(k);
      }
    }
  },

  async flush() {
    try {
      if (isRedisConnected && redisClient) {
        await redisClient.flushdb();
      }
    } catch {}
    memoryStore.clear();
  },

  isRedisActive() {
    return isRedisConnected;
  },
};

module.exports = cache;
