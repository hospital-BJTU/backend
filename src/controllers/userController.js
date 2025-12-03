const { User } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sendVerificationSms, verifySmsCode } = require('../utils/smsService');
// dotenv已在server.js中全局配置

// JWT相关配置

// JWT密钥，实际项目中应存储在环境变量中
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '24h'; // Token过期时间

// 获取所有用户
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll();
    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: users
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '获取用户失败',
      data: { error: error.message }
    });
  }
};



// 创建新用户
exports.createUser = async (req, res) => {
  try {
    // 请求体存在性检测
    if (!req.body) {
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
        data: null
      });
    }
    
    const { username, password, role, phone } = req.body;
    
    // 基本验证
    if (!username || !password) {
      return res.status(400).json({
        code: 400,
        message: '请填写必填字段',
        data: null
      });
    }
    
    // 验证手机号格式（如果提供）
    if (phone) {
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          code: 400,
          message: '请输入正确的手机号码',
          data: null
        });
      }
    }
    
    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 手动生成user_id - 获取当前最大ID值
    const maxIdResult = await User.max('user_id');
    const newUserId = maxIdResult ? maxIdResult + 1 : 1;
    
    // 创建用户
    const user = await User.create({
      user_id: newUserId,
      username,
      password: hashedPassword,
      role: role || 'patient',
      phone: phone || null
      // verifyStatus有默认值'unverified'
    });
    
    // 返回符合要求的格式
    res.status(201).json({
      code: 201,
      message: '注册成功，请完成身份核验。',
      data: {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
        verifyStatus: user.verifyStatus
      }
    });
  } catch (error) {
    // 检查是否为唯一约束错误
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 409,
        message: '用户名已存在',
        data: null
      });
    }
    
    // 添加详细错误日志以帮助调试
    console.error('注册失败错误详情:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
};



// 用户登录
exports.loginUser = async (req, res) => {
  try {
    // 请求体存在性检测
    if (!req.body) {
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
        data: null
      });
    }
    
    const { username, password } = req.body;
    
    // 基本验证
    if (!username || !password) {
      return res.status(400).json({
        code: 400,
        message: '请输入用户名和密码',
        data: null
      });
    }
    
    // 查找用户
    const user = await User.findOne({ where: { username } });
    
    if (!user) {
      return res.status(401).json({
        code: 401,
        message: '用户名或密码错误',
        data: null
      });
    }
    
    // 验证密码 - 支持明文密码（数据库中密码未哈希的情况）
    let isPasswordValid = false;
    
    try {
      // 尝试使用bcrypt验证（如果密码是哈希过的）
      isPasswordValid = await bcrypt.compare(password, user.password);
    } catch (error) {
      // bcrypt验证失败，可能是明文密码
      console.log('Bcrypt验证失败，尝试直接比较明文密码');
    }
    
    // 如果bcrypt验证失败，尝试直接比较明文密码
    if (!isPasswordValid) {
      isPasswordValid = (password === user.password);
    }
    
    if (!isPasswordValid) {
      return res.status(401).json({
        code: 401,
        message: '用户名或密码错误',
        data: null
      });
    }
    
    console.log('用户对象信息 (用于生成Token):', JSON.stringify(user));

    // 生成JWT token
    const token = jwt.sign(
      {
        user_id: user.user_id || user.userId,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // 返回符合要求的格式
    res.status(200).json({
      code: 200,
      message: '登录成功。',
      data: {
        token,
        user: {
          user_id: user.user_id || user.id,
          username: user.username,
          role: user.role,
          verifyStatus: user.verifyStatus
        }
      }
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({
      code: 500,
      message: '登录失败',
      data: null
    });
  }
};



// 用户身份核验
exports.verifyUser = async (req, res) => {
  try {
    // 用户信息空值检测
    if (!req.user) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    // 从JWT中间件获取用户ID
    const { user_id } = req.user;
    
    // 确保user_id存在
    if (!user_id) {
      return res.status(401).json({
        code: 401,
        message: '用户信息不完整',
        data: null
      });
    }
     
    // 查找用户
    const user = await User.findByPk(user_id);
    
    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }
    
    // 检查用户当前状态
    if (user.verifyStatus === 'verified') {
      return res.status(200).json({
        code: 200,
        message: '您已完成身份核验！',
        data: {
          verifyStatus: user.verifyStatus
        }
      });
    }
    
    // 简化的身份核验逻辑，直接更新用户状态
    // 在实际应用中，可以根据业务需求添加适当的验证步骤
    await user.update({
      verifyStatus: 'verified'
    });
    
    // 返回成功响应
    return res.status(200).json({
      code: 200,
      message: '身份核验成功！',
      data: {
        verifyStatus: 'verified'
      }
    });
  } catch (error) {
    console.error('身份核验失败:', error);
    res.status(500).json({
      code: 500,
      message: '身份核验过程中发生错误',
      data: null
    });
  }
};

// 发送验证码（忘记密码第一步）
exports.sendVerificationCode = async (req, res) => {
  try {
    // 请求体存在性检测
    if (!req.body) {
      console.log('请求体为空');
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
        data: null
      });
    }
    
    console.log('收到发送验证码请求:', req.body);
    const { phone } = req.body;
    
    if (!phone) {
      console.log('手机号为空');
      return res.status(400).json({
        code: 400,
        message: '手机号不能为空',
        data: null
      });
    }
    
    // 验证手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      console.log('手机号格式错误:', phone);
      return res.status(400).json({
        code: 400,
        message: '请输入正确的手机号码',
        data: null
      });
    }
    
    // 查找用户是否存在
    const user = await User.findOne({ where: { phone } });
    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '该手机号未注册',
        data: null
      });
    }
    
    // 通过smsService发送验证码（会自动存储到数据库）
    const smsResult = await sendVerificationSms(phone, user.username, 'reset_password');
    
    if (!smsResult.success) {
      return res.status(500).json({
        code: 500,
        message: smsResult.error || '发送验证码失败',
        data: null
      });
    }
    
    // 生成临时令牌（用于验证身份）
    const tempToken = jwt.sign(
      {
        user_id: user.user_id,
        username: user.username,
        phone: user.phone
      },
      JWT_SECRET,
      { expiresIn: '10m' }
    );
    
    res.status(200).json({
      code: 200,
      message: '验证码发送成功',
      data: {
        tempToken: tempToken
      }
    });
  } catch (error) {
    console.error('发送验证码失败:', error);
    res.status(500).json({
      code: 500,
      message: '发送验证码失败',
      data: null
    });
  }
};

// 验证验证码（忘记密码第二步）
exports.verifyCode = async (req, res) => {
  try {
    // 请求体存在性检测
    if (!req.body) {
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
        data: null
      });
    }
    
    const { tempToken, code } = req.body;
    
    if (!tempToken || !code) {
      return res.status(400).json({
        code: 400,
        message: '请提供临时令牌和验证码',
        data: null
      });
    }
    
    // 验证临时令牌
    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        code: 401,
        message: '无效的临时令牌',
        data: null
      });
    }
    
    // 通过smsService验证验证码
    const verifyResult = await verifySmsCode(decoded.phone, code, 'reset_password');
    
    if (!verifyResult.valid) {
      return res.status(400).json({
        code: 400,
        message: verifyResult.error || '验证码错误',
        data: null
      });
    }
    
    // 查找用户
    const user = await User.findOne({ where: { user_id: decoded.user_id || decoded.userId } });
    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }
    
    // 验证用户信息一致性
    if (user.username !== decoded.username || user.phone !== decoded.phone) {
      return res.status(401).json({
        code: 401,
        message: '用户信息不匹配',
        data: null
      });
    }
    
    // 生成重置密码令牌
    const resetToken = jwt.sign(
      {
        user_id: user.user_id,
        username: user.username,
        phone: user.phone
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    
    res.status(200).json({
      code: 200,
      message: '验证码验证成功',
      data: {
        resetToken: resetToken
      }
    });
  } catch (error) {
    console.error('验证验证码失败:', error);
    res.status(500).json({
      code: 500,
      message: '服务器内部错误',
      data: null
    });
  }
};

// 重置密码（忘记密码第三步）
exports.resetPassword = async (req, res) => {
  try {
    // 请求体存在性检测
    if (!req.body) {
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
        data: null
      });
    }
    
    const { resetToken, newPassword } = req.body;
    
    // 基本验证
    if (!resetToken || !newPassword) {
      return res.status(400).json({
        code: 400,
        message: '请提供重置令牌和新密码',
        data: null
      });
    }
    
    // 密码强度验证
    if (newPassword.length < 6) {
      return res.status(400).json({
        code: 400,
        message: '密码长度不能少于6位',
        data: null
      });
    }
    
    // 验证重置令牌
    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        code: 401,
        message: '无效的重置令牌',
        data: null
      });
    }
    
    // 查找用户
    const user = await User.findOne({ where: { user_id: decoded.user_id || decoded.userId } });
    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }
    
    // 验证用户信息一致性
    if (user.username !== decoded.username || user.phone !== decoded.phone) {
      return res.status(401).json({
        code: 401,
        message: '用户信息不匹配',
        data: null
      });
    }
    
    // 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });
    
    res.status(200).json({
      code: 200,
      message: '密码重置成功',
      data: null
    });
  } catch (error) {
    console.error('重置密码失败:', error);
    res.status(500).json({
      code: 500,
      message: '重置密码失败',
      data: null
    });
  }
};

