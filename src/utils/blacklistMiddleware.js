/**
 * 黑名单检查中间件
 * 用于在用户执行敏感操作前，检查其 accountStatus 是否为 'banned' 或 'temp_locked'
 */

/**
 * 检查用户是否在黑名单中（被封禁或临时锁定）
 * @returns {Function} Express中间件函数
 */
const checkBlacklist = async (req, res, next) => {
  try {
    // 首先检查用户是否已通过身份验证（确保authenticateJWT中间件已在前面使用）
    if (!req.user) {
      return res.status(401).json({
        code: 401,
        message: '用户未认证，请先登录',
        data: null
      });
    }

    // 检查用户账户状态（直接使用authenticateJWT中已获取的用户信息）
    const accountStatus = req.user.accountStatus;
    
    // 如果用户账户状态不存在（可能是旧token或未更新的用户信息）
    if (!accountStatus) {
      // 记录警告但允许继续，让authenticateJWT中间件下次请求时更新用户信息
      console.warn(`用户ID ${req.user.userId} 未包含账户状态信息`);
      return next();
    }

    // 检查是否被封禁或临时锁定
    if (accountStatus === 'banned' || accountStatus === 'temp_locked') {
      return res.status(403).json({
        code: 403,
        message: `您的账户已被${accountStatus === 'banned' ? '封禁' : '临时锁定'}，无法执行此操作`,
        data: null
      });
    }

    // 账户状态正常，允许继续
    next();
  } catch (error) {
    console.error('黑名单检查失败:', error);
    return res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
};

/**
 * 创建可选的黑名单检查中间件
 * 只在用户已登录时检查账户状态，未登录用户不会被阻止
 * @returns {Function} Express中间件函数
 */
const optionalCheckBlacklist = (req, res, next) => {
  // 只有已登录用户才检查账户状态
  if (req.user && req.user.accountStatus) {
    const accountStatus = req.user.accountStatus;
    
    // 检查是否被封禁
    if (accountStatus === 'banned') {
      return res.status(403).json({
        code: 403,
        message: '您的账户已被封禁，无法执行此操作',
        data: null
      });
    }

    // 检查是否被临时锁定
    if (accountStatus === 'temp_locked') {
      return res.status(403).json({
        code: 403,
        message: '您的账户已被临时锁定，请稍后再试',
        data: null
      });
    }
  }
  
  // 未登录用户或账户状态正常的用户，允许继续
  next();
};

module.exports = {
  checkBlacklist,
  optionalCheckBlacklist
};

/**
 * 使用示例：
 * 
 * 1. 在需要用户必须登录且账户正常的路由中使用：
 * const { checkBlacklist } = require('../utils/blacklistMiddleware');
 * router.post('/sensitive-operation', authenticateJWT, checkBlacklist, controller.handler);
 * 
 * 2. 在可选登录但登录用户需检查状态的路由中使用：
 * const { optionalCheckBlacklist } = require('../utils/blacklistMiddleware');
 * router.get('/public-but-restricted', optionalCheckBlacklist, controller.handler);
 * 
 * 重要：checkBlacklist中间件必须在authenticateJWT中间件之后使用，
 * 确保req.user对象已被设置且包含accountStatus字段。
 */