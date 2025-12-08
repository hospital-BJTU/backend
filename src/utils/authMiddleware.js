const jwt = require('jsonwebtoken');
const { User } = require('../models');
// dotenv已在server.js中全局配置

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
console.log('使用的JWT_SECRET:', JWT_SECRET); // 添加调试日志

// 【新增】管理员权限校验中间件
const isAdmin = (req, res, next) => {
    // 假设 authenticateJWT 已经将用户信息（包括 role）设置到 req.user
    if (req.user && req.user.role === 'admin') {
        next(); // 身份是管理员，继续执行
    } else {
        // 403 Forbidden - 已认证但权限不足
        return res.status(403).json({ 
            code: 403, 
            message: '权限不足，需要管理员身份', 
            data: null 
        });
    }
};

// JWT验证中间件
const authenticateJWT = async (req, res, next) => {
  console.log('=== JWT认证中间件开始 ===');
  console.log('请求路径:', req.path);
  console.log('请求方法:', req.method);
  
  const authHeader = req.headers.authorization;
  console.log('Authorization头:', authHeader);
  
  if (!authHeader) {
    console.log('缺少认证令牌');
    return res.status(401).json({
      code: 401,
      message: '缺少认证令牌',
      data: null
    });
  }
  
  // 检查Bearer前缀
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    console.log('认证令牌格式错误');
    return res.status(401).json({
      code: 401,
      message: '认证令牌格式错误',
      data: null
    });
  }
  
  const token = parts[1];
  console.log('提取的Token:', token.substring(0, 20) + '...');
  
  try {
    // 验证token
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('JWT解码结果:', JSON.stringify(decoded));
    
    // 兼容新旧token格式，获取用户ID
    const userId = decoded.userId || decoded.user_id;
    console.log('提取的用户ID:', userId);
    
    if (!userId) {
      console.log('用户ID不存在于token中');
      return res.status(401).json({
        code: 401,
        message: '认证令牌格式错误，缺少用户ID',
        data: null
      });
    }
    
    // 查找用户是否存在
    console.log('开始查找用户，用户ID:', userId);
    const user = await User.findByPk(userId);
    
    if (!user) {
      console.log('用户不存在，用户ID:', userId);
      return res.status(401).json({
        code: 401,
        message: '用户不存在',
        data: null
      });
    }
    
    console.log('找到用户:', JSON.stringify({
      userId: user.userId,
      username: user.username,
      role: user.role,
      accountStatus: user.accountStatus
    }));
    console.log('用户对象的userId字段值:', user.userId);
    
    // 检查用户状态
    if (user.accountStatus !== 'active') {
      console.log('账户状态异常:', user.accountStatus);
      return res.status(403).json({
        code: 403,
        message: '账户已被禁用',
        data: null
      });
    }
    
    // 将用户信息存储在请求对象中，确保user_id字段正确设置
    req.user = {
      user_id: user.userId, // 使用userId属性，因为数据库模型定义的是userId
      userId: user.userId, // 保留userId以兼容旧代码
      username: user.username,
      role: user.role,
      accountStatus: user.accountStatus // 添加账户状态字段
    };
    
    console.log('认证成功，用户信息:', JSON.stringify(req.user));
    console.log('req.user.user_id值:', req.user.user_id);
    console.log('req.user.userId值:', req.user.userId);
    console.log('=== JWT认证中间件结束 ===');
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

module.exports = { 
    authenticateJWT, // 现在可以被其他路由使用
    isAdmin          // 现在可以在 adminRoutes.js 中被导入和使用
};