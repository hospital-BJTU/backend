const crypto = require('crypto');

// 从captchaController导入captchaStore
const captchaController = require('../controllers/captchaController');

/**
 * 验证码验证中间件
 * 用于保护敏感操作接口，要求用户提供有效的验证码
 */
const verifyCaptcha = async (req, res, next) => {
  try {
    // 从请求体中获取验证码信息
    const { captchaId, captchaCode } = req.body;
    
    // 参数验证
    if (!captchaId || !captchaCode) {
      return res.status(400).json({
        code: 400,
        message: '请提供验证码',
        data: null
      });
    }
    
    // 从captchaController中获取验证码存储
    // 注意：这里需要确保captchaStore是可访问的
    // 如果captchaStore是私有的，可能需要修改captchaController将其导出
    const captchaStore = captchaController.captchaStore || captchaController._captchaStore;
    
    // 验证验证码存储是否存在
    if (!captchaStore) {
      console.error('验证码存储未找到');
      return res.status(500).json({
        code: 500,
        message: '验证码系统错误',
        data: null
      });
    }
    
    // 获取存储的验证码
    const storedCaptcha = captchaStore.get(captchaId);
    
    if (!storedCaptcha) {
      return res.status(400).json({
        code: 400,
        message: '验证码已过期或不存在',
        data: null
      });
    }
    
    // 检查是否过期（5分钟）
    if (Date.now() - storedCaptcha.timestamp > 5 * 60 * 1000) {
      captchaStore.delete(captchaId);
      return res.status(400).json({
        code: 400,
        message: '验证码已过期',
        data: null
      });
    }
    
    // 验证验证码（不区分大小写）
    if (captchaCode.toLowerCase() !== storedCaptcha.code) {
      return res.status(400).json({
        code: 400,
        message: '验证码错误',
        data: null
      });
    }
    
    // 验证成功后删除验证码（一次性使用）
    captchaStore.delete(captchaId);
    
    // 验证码验证通过，继续处理请求
    next();
    
  } catch (error) {
    console.error('验证码验证中间件错误:', error);
    return res.status(500).json({
      code: 500,
      message: '验证码验证过程中发生错误',
      data: null
    });
  }
};

/**
 * 可选的验证码验证中间件
 * 在请求频率较高或IP信誉较低时触发验证
 * 这里简化实现，可以与rateLimitMiddleware结合使用
 */
const optionalVerifyCaptcha = async (req, res, next) => {
  // 这里可以实现更复杂的逻辑，比如：
  // 1. 检查用户历史行为
  // 2. 检查IP信誉度
  // 3. 基于机器学习的异常检测
  
  // 简化实现：直接调用强制验证
  // 在实际应用中，可以根据风险评分决定是否需要验证
  return verifyCaptcha(req, res, next);
};

module.exports = {
  verifyCaptcha,
  optionalVerifyCaptcha
};
