const jwt = require('jsonwebtoken');
const { User } = require('../models'); // 确保导入了 User 模型
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// JWT验证中间件
const authenticateJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({
      code: 401,
      message: '缺少认证令牌',
      data: null
    });
  }
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      code: 401,
      message: '认证令牌格式错误',
      data: null
    });
  }
  
  const token = parts[1];
  
  try {
    // 验证token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 兼容新旧token格式，获取用户ID (从token payload中)
    const idFromToken = decoded.user_id || decoded.userId; 
    
    if (!idFromToken) {
        return res.status(401).json({
            code: 401,
            message: '认证令牌中缺少用户ID信息',
            data: null
        });
    }
    
    // 启用数据库查询，验证用户存在性和状态
    const user = await User.findByPk(idFromToken);
    
    if (!user) {
      return res.status(401).json({
        code: 401,
        message: '用户不存在或令牌已失效',
        data: null
      });
    }

    // 【关键修复点】安全地从数据库对象中获取用户ID
    // 兼容 Sequelize 的 user.userId 或 user.user_id 属性
    const finalUserId = user.userId || user.user_id;

    // 将用户信息存储在请求对象中
    req.user = {
      // 确保赋值给 appointmentController 依赖的 user_id
      user_id: finalUserId, 
      userId: finalUserId, 
      username: user.username,
      role: user.role
    };
    
    next();
    
  } catch (error) {
    console.error('JWT验证失败:', error.message);
    
    // 区分不同类型的JWT错误
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        code: 401,
        message: '认证令牌已过期，请重新登录',
        data: null
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        code: 401,
        message: '认证令牌格式错误',
        data: null
      });
    }
    
    res.status(401).json({
      code: 401,
      message: '无效的认证令牌',
      data: null
    });
  }
};

module.exports = authenticateJWT;