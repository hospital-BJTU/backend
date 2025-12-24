const { User, UserProfile } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { sendVerificationSms, verifySmsCode } = require('../utils/smsService');
// dotenv已在server.js中全局配置

// JWT相关配置

// JWT密钥，实际项目中应存储在环境变量中
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '24h'; // Token过期时间

// 获取所有用户
exports.getAllUsers = async (req, res) => {
  try {
    const { username } = req.query;
    const where = {};
    
    if (username) {
      where.username = { [Op.like]: `%${username}%` };
    }

    const users = await User.findAll({ where });
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
    const maxIdResult = await User.max('userId');
    const newUserId = maxIdResult ? maxIdResult + 1 : 1;
    
    // 创建用户
    const user = await User.create({
      userId: newUserId,
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
        userId: user.userId,
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



// 用户登录（支持用户名密码登录和微信登录）
exports.loginUser = async (req, res) => {
  try {
    console.log('=== 登录请求开始 ===');
    console.log('请求方法:', req.method);
    console.log('请求路径:', req.path);
    console.log('请求头:', req.headers);
    console.log('请求体:', req.body);
    
    // 请求体存在性检测
    if (!req.body) {
      console.log('请求体为空');
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
        data: null
      });
    }
    
    const { username, password, wxCode } = req.body;
    console.log('登录参数:', { username, password: password ? '******' : undefined, wxCode });
    
    // 微信登录逻辑
    if (wxCode) {
      // 验证微信配置是否存在
      if (!process.env.WECHAT_APPID || !process.env.WECHAT_APPSECRET) {
        return res.status(500).json({
          code: 500,
          message: '微信登录配置未完成',
          data: null
        });
      }

      // 调用微信API获取openid和session_key
      const wechatApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${process.env.WECHAT_APPID}&secret=${process.env.WECHAT_APPSECRET}&js_code=${wxCode}&grant_type=authorization_code`;
      
      try {
        const wechatResponse = await axios.get(wechatApiUrl);
        const { openid, session_key, errcode, errmsg } = wechatResponse.data;
        
        if (errcode) {
          return res.status(401).json({
            code: 401,
            message: `微信登录失败: ${errmsg}`,
            data: null
          });
        }

        // 根据openid查找用户
        let user = await User.findOne({ where: { wxOpenId: openid } });

        if (!user) {
          // 如果用户不存在，创建新用户
          // 生成虚拟手机号（10000000000 - 10000999999）
          const virtualPhone = `10000${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`;
          const virtualUsername = `wx_${openid.substring(0, 20)}`;
          
          // 手动生成userId - 获取当前最大ID值
          const maxIdResult = await User.max('userId');
          const newUserId = maxIdResult ? maxIdResult + 1 : 1;
          
          user = await User.create({
            userId: newUserId,
            username: virtualUsername,
            password: await bcrypt.hash(openid.substring(0, 8), 10), // 使用openid前8位作为初始密码
            phone: virtualPhone, // 模型中定义的是phone字段，不是phoneNumber
            wxOpenId: openid,
            accountStatus: 'active', // 与模型定义的ENUM值保持一致（小写）
            role: 'patient' // 与模型定义的ENUM值保持一致（小写）
          });
        }

        // 检查账户状态
        if (user.accountStatus !== 'active') {
          return res.status(403).json({
            code: 403,
            message: '账户已被禁用，请联系管理员',
            data: null
          });
        }

        console.log('微信登录用户对象信息 (用于生成Token):', JSON.stringify(user));

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
        
        // 解析令牌信息，用于调试和客户端确认
        const decodedToken = jwt.decode(token);
        console.log('微信登录生成的完整令牌:', token);
        console.log('微信登录生成的令牌信息:', {
          decodedToken,
          userId: user.user_id || user.userId,
          username: user.username,
          tokenExpiresAt: new Date(decodedToken.exp * 1000)
        });

        return res.status(200).json({
          code: 200,
          message: '登录成功。',
          data: {
            token,
            tokenInfo: {
              userId: user.user_id || user.userId,
              username: user.username,
              issuedAt: decodedToken.iat * 1000,
              expiresAt: decodedToken.exp * 1000
            },
            user: {
              user_id: user.user_id || user.userId, // 使用模型中定义的userId字段
              username: user.username,
              role: user.role,
              verifyStatus: user.verifyStatus
            }
          }
        });
      } catch (wechatError) {
        console.error('微信API调用失败:', wechatError);
        return res.status(500).json({
          code: 500,
          message: '微信登录失败，请稍后重试',
          data: null
        });
      }
    }

    // 用户名密码登录逻辑
    if (!username || !password) {
      console.log('用户名或密码为空');
      return res.status(400).json({
        code: 400,
        message: '请输入用户名和密码',
        data: null
      });
    }
    
    // 查找用户
    console.log('正在查找用户:', username);
    const user = await User.findOne({ where: { username } });
    
    console.log('用户查找结果:', user ? JSON.stringify(user) : '用户不存在');
    
    if (!user) {
      console.log('用户不存在:', username);
      return res.status(401).json({
        code: 401,
        message: '用户名或密码错误',
        data: null
      });
    }
    
    // 验证密码 - 只使用bcrypt验证
    let isPasswordValid = false;
    
    try {
      // 只使用bcrypt验证密码
      console.log('正在验证密码');
      isPasswordValid = await bcrypt.compare(password, user.password);
      console.log('密码验证结果:', isPasswordValid);
    } catch (error) {
      console.error('密码验证失败:', error);
    }
    
    if (!isPasswordValid) {
      console.log('密码验证失败');
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
          user_id: user.user_id || user.userId, // 使用模型中定义的userId字段
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
    
    // 获取请求参数
    const { realName, idCard } = req.body;
    
    // 验证参数完整性
    if (!realName || !idCard) {
      return res.status(400).json({
        code: 400,
        message: '请填写完整的身份信息',
        data: null
      });
    }
    
    // 验证真实姓名格式
    const validateRealName = (name) => {
      const regex = /^[\u4e00-\u9fa5]{2,20}$/;
      return regex.test(name);
    };
    
    // 验证身份证号码格式
    const validateIdCard = (id) => {
      const regex = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/;
      return regex.test(id);
    };
    
    // 验证参数格式
    if (!validateRealName(realName)) {
      return res.status(400).json({
        code: 400,
        message: '真实姓名格式不正确，请输入2-20个中文字符',
        data: null
      });
    }
    
    if (!validateIdCard(idCard)) {
      return res.status(400).json({
        code: 400,
        message: '身份证号码格式不正确，请输入有效的18位身份证号码',
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
    
    // 验证身份信息的逻辑可以在这里扩展
    // 例如调用第三方身份验证服务、与数据库中存储的其他用户信息比对等
    console.log('验证身份信息:', JSON.stringify({ realName, idCard }));
    
    // 对于首次身份核验，直接使用用户输入的信息
    // 如果需要更严格的验证，可以在此处添加第三方验证服务的调用
    const matchedData = { realName, idCard };
    
    // 【新增】检查该身份证是否已经被其他用户绑定
    const existingProfile = await UserProfile.findOne({ where: { idCard } });
    if (existingProfile) {
      return res.status(409).json({
        code: 409,
        message: '该身份证号码已被其他账号绑定',
        data: null
      });
    }
    
    // 查找或创建用户详细信息
    let userProfile = await UserProfile.findOne({ where: { userId: user_id } });
    
    if (userProfile) {
      // 更新现有用户信息
      await userProfile.update({
        realName: matchedData.realName,
        idCard: matchedData.idCard,
        updatedAt: new Date()
      });
    } else {
      // 创建新的用户信息记录
      userProfile = await UserProfile.create({
        userId: user_id,
        realName: matchedData.realName,
        idCard: matchedData.idCard,
        updatedAt: new Date()
      });
    }
    
    // 身份信息匹配，更新用户核验状态
    await user.update({
      verifyStatus: 'verified'
    });
    
    // 返回成功响应
    return res.status(200).json({
      code: 200,
      message: '身份核验成功！',
      data: {
        verifyStatus: 'verified',
        realName: matchedData.realName,
        idCard: matchedData.idCard
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
        user_id: user.userId,
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
    const user = await User.findOne({ where: { userId: decoded.user_id || decoded.userId } });
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
        user_id: user.userId,
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
    const user = await User.findOne({ where: { userId: decoded.user_id || decoded.userId } });
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


// 修改密码（已登录用户）
exports.changePassword = async (req, res) => {
  try {
    // 请求体存在性检测
    if (!req.body) {
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
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
    
    const { oldPassword, newPassword } = req.body;
    
    // 基本验证
    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        code: 400,
        message: '请提供原密码和新密码',
        data: null
      });
    }
    
    // 密码强度验证
    if (newPassword.length < 6) {
      return res.status(400).json({
        code: 400,
        message: '新密码长度不能少于6位',
        data: null
      });
    }
    
    // 查找用户
    const user = await User.findOne({ where: { userId: user_id } });
    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }
    
    // 验证原密码 - 只使用bcrypt验证
    let isPasswordValid = false;
    
    try {
      // 只使用bcrypt验证密码
      isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    } catch (error) {
      console.error('原密码验证失败:', error);
    }
    
    if (!isPasswordValid) {
      return res.status(401).json({
        code: 401,
        message: '原密码错误',
        data: null
      });
    }
    
    // 更新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hashedPassword });
    
    res.status(200).json({
      code: 200,
      message: '密码修改成功',
      data: null
    });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(500).json({
      code: 500,
      message: '修改密码失败',
      data: null
    });
  }
};