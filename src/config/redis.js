const { createClient } = require('redis');
// dotenv已在server.js中全局配置

// 创建Redis客户端
const redisClient = createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  database: process.env.REDIS_DB || 0
});

// 连接Redis
const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log('Redis连接成功');
  } catch (error) {
    console.error('Redis连接失败:', error);
    // Redis连接失败不会导致应用退出，但会记录错误
    // 可以根据实际需求决定是否退出应用
  }
};

// 断开Redis连接
const disconnectRedis = async () => {
  try {
    await redisClient.disconnect();
    console.log('Redis连接已断开');
  } catch (error) {
    console.error('Redis断开连接失败:', error);
  }
};

// 测试Redis连接是否正常
const isRedisConnected = () => {
  return redisClient.isReady;
};

// 常用的Redis操作封装
const redisOperations = {
  // 设置键值对
  set: async (key, value, expiration = null) => {
    try {
      if (!isRedisConnected()) {
        console.warn('Redis未连接，跳过操作');
        return false;
      }
      
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      
      if (expiration) {
        await redisClient.set(key, stringValue, { EX: expiration });
      } else {
        await redisClient.set(key, stringValue);
      }
      return true;
    } catch (error) {
      console.error(`Redis set操作失败 [${key}]:`, error);
      return false;
    }
  },
  
  // 获取值
  get: async (key, parseJson = false) => {
    try {
      if (!isRedisConnected()) {
        console.warn('Redis未连接，跳过操作');
        return null;
      }
      
      const value = await redisClient.get(key);
      if (!value) return null;
      
      return parseJson ? JSON.parse(value) : value;
    } catch (error) {
      console.error(`Redis get操作失败 [${key}]:`, error);
      return null;
    }
  },
  
  // 删除键
  del: async (key) => {
    try {
      if (!isRedisConnected()) {
        console.warn('Redis未连接，跳过操作');
        return false;
      }
      
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error(`Redis del操作失败 [${key}]:`, error);
      return false;
    }
  },
  
  // 设置过期时间
  expire: async (key, seconds) => {
    try {
      if (!isRedisConnected()) {
        console.warn('Redis未连接，跳过操作');
        return false;
      }
      
      await redisClient.expire(key, seconds);
      return true;
    } catch (error) {
      console.error(`Redis expire操作失败 [${key}]:`, error);
      return false;
    }
  },
  
  // 检查键是否存在
  exists: async (key) => {
    try {
      if (!isRedisConnected()) {
        console.warn('Redis未连接，跳过操作');
        return false;
      }
      
      const result = await redisClient.exists(key);
      return result > 0;
    } catch (error) {
      console.error(`Redis exists操作失败 [${key}]:`, error);
      return false;
    }
  }
};

module.exports = {
  redisClient,
  connectRedis,
  disconnectRedis,
  isRedisConnected,
  ...redisOperations
};