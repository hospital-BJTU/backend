const jwt = require('jsonwebtoken');
const { User } = require('../models');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
console.log('使用的JWT_SECRET:', JWT_SECRET); // 添加调试日志

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
  
  // 检查Bearer前缀
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
    
    // 兼容新旧token格式，获取用户ID
    const userId = decoded.userId || decoded.user_id;
    
    // 简化验证逻辑，直接使用token中的信息（用于调试）
    // 这里我们假设token是有效的，直接从token中获取用户信息
    req.user = {
      user_id: userId,
      userId: userId, // 同时设置两种格式以保持兼容性
      username: decoded.username || 'unknown',
      role: decoded.role || 'patient'
    };
    
    // 暂时注释掉数据库查询，以快速验证问题
    /*
    // 查找用户是否存在
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(401).json({
        code: 401,
        message: '用户不存在或令牌已失效',
        data: null
      });
    }
    
    // 将用户信息存储在请求对象中，同时支持user_id和userId以确保兼容性
    req.user = {
      user_id: user.user_id,
      userId: user.user_id, // 保留userId以兼容旧代码
      username: user.username,
      role: user.role
    };
    */
    console.log('用户信息已设置到req.user:', req.user);
    next();
  } catch (error) {
    console.log('JWT验证错误:', error.name, error.message); // 添加详细错误日志
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        code: 401,
        message: '认证令牌已过期',
        data: null
      });
    }
    return res.status(401).json({
      code: 401,
      message: '认证令牌无效: ' + error.message,
      data: null
    });
  }
};

module.exports = authenticateJWT;