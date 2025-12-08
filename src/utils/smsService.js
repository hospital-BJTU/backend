// dotenv已在server.js中全局配置
const https = require('https');
const { SmsVerification } = require('../models');
const { Op, sequelize } = require('../config/database');

/**
 * 生成6位数字验证码
 * @returns {string} - 6位数字验证码
 */
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送验证码短信并存储到数据库
 * @param {string} phone - 接收短信的手机号
 * @param {string} username - 用户名
 * @param {string} purpose - 验证码用途 (login, register, reset_password)
 * @returns {Promise<{success: boolean, code?: string, error?: string}>} - 发送结果
 */
async function sendVerificationSms(phone, username, purpose = 'reset_password') {
  try {
    // 生成验证码
    const code = generateVerificationCode();
    
    // 设置验证码过期时间（5分钟后）
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);
    
    // 先将同一手机号的旧验证码标记为过期
    await sequelize.query(
      "UPDATE tb_sms_verification SET status = 'expired' WHERE phone = ? AND status = 'pending'",
      {
        replacements: [phone],
        type: sequelize.QueryTypes.UPDATE
      }
    );
    
    // 存储验证码到数据库
    await sequelize.query(
      "INSERT INTO tb_sms_verification (phone, code, purpose, status, expires_at, created_at) VALUES (?, ?, ?, 'pending', ?, NOW())",
      {
        replacements: [phone, code, purpose, expiresAt],
        type: sequelize.QueryTypes.INSERT
      }
    );
    
    // 检查是否配置了真实的短信服务，默认使用spug
    const smsServiceProvider = process.env.SMS_SERVICE_PROVIDER || 'spug';
    
    // 根据配置选择不同的短信服务提供商
    switch (smsServiceProvider) {
      case 'spug':
        const sendResult = await sendSpugSms(phone, username, code);
        if (sendResult) {
          return { success: true, code };
        } else {
          return { success: false, error: '短信发送失败' };
        }
      case 'mock':
        // 模拟短信发送（开发阶段使用）
        
        return { success: true, code };
      default:
        console.error('不支持的短信服务提供商');
        return { success: false, error: '不支持的短信服务提供商' };
    }
  } catch (error) {
    console.error('发送短信失败:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 验证短信验证码是否正确有效
 * @param {string} phone - 手机号
 * @param {string} code - 验证码
 * @param {string} purpose - 验证码用途
 * @returns {Promise<{valid: boolean, error?: string}>} - 验证结果
 */
async function verifySmsCode(phone, code, purpose = 'reset_password') {
  try {
    // 使用原生SQL查找有效的验证码
    const [verification] = await sequelize.query(
      "SELECT * FROM tb_sms_verification WHERE phone = ? AND code = ? AND purpose = ? AND status = 'pending' AND expires_at > NOW() LIMIT 1",
      {
        replacements: [phone, code, purpose],
        type: sequelize.QueryTypes.SELECT
      }
    );
    
    if (!verification) {
      // 检查是否是过期的验证码
      const [expired] = await sequelize.query(
        "SELECT * FROM tb_sms_verification WHERE phone = ? AND code = ? AND purpose = ? AND status = 'pending' AND expires_at <= NOW() LIMIT 1",
        {
          replacements: [phone, code, purpose],
          type: sequelize.QueryTypes.SELECT
        }
      );
      
      if (expired) {
        // 更新过期验证码状态
        await sequelize.query(
          "UPDATE tb_sms_verification SET status = 'expired' WHERE id = ?",
          {
            replacements: [expired.id],
            type: sequelize.QueryTypes.UPDATE
          }
        );
        return { valid: false, error: '验证码已过期' };
      }
      
      return { valid: false, error: '验证码错误或不存在' };
    }
    
    // 更新验证码状态为已使用
    await sequelize.query(
      "UPDATE tb_sms_verification SET status = 'used' WHERE id = ?",
      {
        replacements: [verification.id],
        type: sequelize.QueryTypes.UPDATE
      }
    );
    
    return { valid: true };
  } catch (error) {
    console.error('验证短信验证码失败:', error);
    return { valid: false, error: error.message };
  }
}

/**
 * 验证短信服务配置是否正确
 * @returns {Promise<boolean>} - 配置是否有效
 */
async function verifySmsConfig() {
  try {
    const smsServiceProvider = process.env.SMS_SERVICE_PROVIDER || 'spug';
    
    switch (smsServiceProvider) {
      case 'spug':
        // 验证Spug短信配置
        const spugConfig = process.env.SPUG_PUSH_URL;
        if (!spugConfig) {
          
          return false;
        }
        
        return true;
      case 'mock':
        
        return true;
      default:
        console.error('不支持的短信服务提供商');
        return false;
    }
  } catch (error) {
    console.error('短信服务配置验证失败:', error);
    return false;
  }
}

/**
 * 使用Spug推送助手发送短信
 * @param {string} phone - 接收短信的手机号
 * @param {string} username - 用户名
 * @param {string} code - 验证码
 * @returns {Promise<boolean>} - 是否发送成功
 */
async function sendSpugSms(phone, username, code) {
  try {
    // 检查必要的配置
    const spugPushUrl = process.env.SPUG_PUSH_URL || 'https://push.spug.cc/send/XlxGd8J43Vj2bn0R';
    
    if (!spugPushUrl) {
      console.error('Spug推送URL配置不完整');
      return false;
    }
    
    // 构建Spug推送URL（使用code和targets作为URL参数）
    const requestUrl = `${spugPushUrl}?code=${code}&targets=${phone}`;
    
    
    
    // 发送HTTP请求到Spug推送助手
    return new Promise((resolve) => {
      https.get(requestUrl, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          
          
          try {
            const parsedData = JSON.parse(data);
            // Spug推送服务返回{"code": 200, "msg": "请求成功"}表示成功
            if (res.statusCode >= 200 && res.statusCode < 300 && 
                (parsedData.code === 200 || parsedData.success === true)) {
              
              resolve(true);
            } else {
              console.error(`Spug推送失败，状态码: ${res.statusCode}, 错误信息: ${parsedData?.msg || parsedData?.message || '未知错误'}`);
              resolve(false);
            }
          } catch (e) {
            // 如果返回的不是JSON，但状态码正常，也视为成功
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log('响应不是JSON格式，但状态码正常，假设推送成功');
              resolve(true);
            } else {
              console.error(`Spug推送失败，状态码: ${res.statusCode}`);
              resolve(false);
            }
          }
        });
      }).on('error', (error) => {
        console.error('Spug推送请求失败:', error);
        resolve(false);
      });
    });
  } catch (error) {
    console.error('Spug短信推送失败:', error);
    return false;
  }
}

module.exports = {
  sendVerificationSms,
  verifySmsCode,
  verifySmsConfig,
  generateVerificationCode
};