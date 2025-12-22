const { redisClient, isRedisConnected, get, set, incr } = require('../config/redis');
const AntiHoardingLogModel = require('../models/AntiHoardingLog');
// 获取AntiHoardingLog模型实例
const AntiHoardingLog = AntiHoardingLogModel.getModel();

/**
 * 基于Redis的IP限流中间件
 * @param {Object} options 配置选项
 * @param {number} options.maxRequests 时间窗口内允许的最大请求数
 * @param {number} options.windowMs 时间窗口大小（毫秒）
 * @param {string} options.action 操作类型（用于日志记录）
 * @returns {Function} Express中间件函数
 */
const createRateLimiter = (options = {}) => {
  const { 
    maxRequests = 10, 
    windowMs = 60000, // 默认1分钟
    action = 'unknown' 
  } = options;

  return async (req, res, next) => {
    try {
      // 获取客户端IP地址
      const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
      
      // 生成Redis键名
      const key = `rate_limit:${action}:${clientIp}`;
      
      // 检查Redis连接
      if (!isRedisConnected()) {
        console.error('Redis连接失败，跳过限流检查');
        return next();
      }

      // 获取当前请求计数
      const currentCount = await get(key);
      
      if (currentCount && parseInt(currentCount) >= maxRequests) {
        // 详细记录限流信息
        console.log(`限流触发: IP=${clientIp}, 当前计数=${currentCount}, 阈值=${maxRequests}`);
        console.log(`用户信息: ${JSON.stringify(req.user)}`);
        try {
          // 记录防抢号日志
          const logEntry = await AntiHoardingLog.create({
            userId: req.user?.userId || null,
            ipAddress: clientIp,
            requestTime: new Date(),
            logType: 'high_frequency'
          });
          console.log(`防抢号日志创建成功: ${JSON.stringify(logEntry)}`);
        } catch (logError) {
          console.error('防抢号日志创建失败:', logError);
          console.error('错误堆栈:', logError.stack);
        }
        
        return res.status(429).json({
          code: 429,
          message: '请求过于频繁，请稍后再试',
          data: null
        });
      }
      
      // 增加计数
      if (currentCount) {
        await redisClient.incr(key);
      } else {
        // 首次请求，设置计数并过期时间
        const seconds = Math.floor(windowMs / 1000);
        await set(key, 1, seconds);
      }
      
      
      // 设置剩余请求数响应头（可选）
      const remaining = maxRequests - (currentCount ? parseInt(currentCount) + 1 : 1);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + (windowMs / 1000));
      
      next();
    } catch (error) {
      console.error('限流中间件错误:', error);
      // 出错时跳过限流检查，确保服务可用性
      next();
    }
  };
};

// 预定义的限流中间件
const rateLimitMiddleware = {
  // 登录接口限流
  loginLimiter: createRateLimiter({
    maxRequests: 5,
    windowMs: 60000, // 1分钟内最多5次登录尝试
    action: 'login'
  }),
  
  // 预约接口限流
  appointmentLimiter: createRateLimiter({
    maxRequests: 10, // 临时增加到100次用于测试
    windowMs: 60000, // 5分钟内最多100次预约请求
    action: 'appointment'
  }),
  
  // 验证码接口限流
  captchaLimiter: createRateLimiter({
    maxRequests: 10,
    windowMs: 60000, // 1分钟内最多10次验证码请求
    action: 'captcha'
  }),
  
  // 通用API限流
  apiLimiter: createRateLimiter({
    maxRequests: 60,
    windowMs: 60000, // 1分钟内最多60次请求
    action: 'api'
  })
};

module.exports = {
  createRateLimiter,
  ...rateLimitMiddleware
};


