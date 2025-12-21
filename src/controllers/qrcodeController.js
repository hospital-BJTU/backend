const qrcode = require('qrcode');
const { Doctor, Department, User } = require('../models');

/**
 * 二维码控制器
 * 处理二维码生成和签到相关功能
 */

/**
 * 生成基础签到二维码
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
const generateSignInQrCode = async (req, res) => {
  try {
    // 动态构建URL，使用请求的协议和主机名
    const protocol = req.protocol;
    const host = req.get('host');
    const signInUrl = `${protocol}://${host}/sign-in.html`;
    
    // 生成二维码图片数据（base64格式）
    const qrCodeDataUrl = await qrcode.toDataURL(signInUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    res.status(200).json({
      code: 200,
      data: {
        qrCode: qrCodeDataUrl,
        signInUrl: signInUrl
      },
      message: '二维码生成成功'
    });
  } catch (error) {
    console.error('生成基础签到二维码失败:', error);
    res.status(500).json({
      code: 500,
      message: '生成二维码失败',
      data: null
    });
  }
};

/**
 * 生成带有科室和医生信息的签到二维码
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
const generateDeptDoctorQrCode = async (req, res) => {
  try {
    const { deptId, doctorId } = req.query;
    
    // 参数验证
    if (!deptId || !doctorId) {
      return res.status(400).json({
        code: 400,
        message: '科室ID和医生ID不能为空',
        data: null
      });
    }
    
    // 生成包含科室和医生信息的签到URL
    // 动态构建URL，使用请求的协议和主机名
    const protocol = req.protocol;
    const host = req.get('host');
    const signInUrl = `${protocol}://${host}/sign-in.html?deptId=${deptId}&doctorId=${doctorId}`;
    
    // 生成二维码图片数据（base64格式）
    const qrCodeDataUrl = await qrcode.toDataURL(signInUrl, {
      width: 256,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    res.status(200).json({
      code: 200,
      data: {
        qrCode: qrCodeDataUrl,
        signInUrl: signInUrl,
        deptId: deptId,
        doctorId: doctorId
      },
      message: '二维码生成成功'
    });
  } catch (error) {
    console.error('生成科室医生签到二维码失败:', error);
    res.status(500).json({
      code: 500,
      message: '生成二维码失败',
      data: null
    });
  }
};

/**
 * 获取签到页面配置信息
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
const getSignInPageConfig = async (req, res) => {
  try {
    const { deptId, doctorId } = req.query;
    
    // 存储查询结果
    let deptName = '';
    let doctorName = '';
    
    // 查询科室名称
    if (deptId) {
      const department = await Department.findByPk(deptId, {
        attributes: ['deptName']
      });
      if (department) {
        deptName = department.deptName;
      }
    }
    
    // 查询医生名称
    if (doctorId) {
      const doctor = await Doctor.findByPk(doctorId, {
        include: [{
          model: User,
          attributes: ['username']
        }]
      });
      if (doctor && doctor.User) {
        doctorName = doctor.User.username;
      }
    }
    
    res.status(200).json({
      code: 200,
      data: {
        deptId: deptId,
        doctorId: doctorId,
        deptName: deptName,
        doctorName: doctorName,
        today: new Date().toISOString().split('T')[0],
        signInStartTime: '08:00',
        signInEndTime: '17:00'
      },
      message: '获取签到页面配置成功'
    });
  } catch (error) {
    console.error('获取签到页面配置失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取签到页面配置失败',
      data: null
    });
  }
};

module.exports = {
  generateSignInQrCode,
  generateDeptDoctorQrCode,
  getSignInPageConfig
};