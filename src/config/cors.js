// dotenv已在server.js中全局配置

// 从环境变量获取配置
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

const allowCredentials = process.env.ALLOW_CREDENTIALS === 'true';

// CORS配置对象
const corsOptions = {
  origin: (origin, callback) => {
    // 开发环境中，如果没有origin（如Postman请求），也允许访问
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('不允许的跨域请求'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: allowCredentials,
  maxAge: 86400, // 预检请求结果缓存24小时
  optionsSuccessStatus: 200
};

module.exports = corsOptions; 