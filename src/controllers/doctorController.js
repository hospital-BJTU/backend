const { Doctor, User, Department } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize'); // 添加 Op 的导入
require('dotenv').config();

// JWT相关配置
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = '24h'; // Token过期时间

// 获取所有医生
exports.getAllDoctors = async (req, res) => {
  try {
    const { username, deptId, title, verifyStatus, page = 1, limit = 10 } = req.query; // 添加 deptId, title, verifyStatus, page, limit 参数
    
    const doctorWhere = {};
    const userWhere = {};

    if (deptId) {
      doctorWhere.deptId = deptId;
    }

    if (title) {
      doctorWhere.title = { [Op.like]: `%${title}%` };
    }

    if (username) {
      userWhere.username = { [Op.like]: `%${username}%` };
    }

    if (verifyStatus) {
      userWhere.verifyStatus = verifyStatus;
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows } = await Doctor.findAndCountAll({
      where: doctorWhere,
      include: [
        {
          model: User,
          attributes: ['userId', 'username', 'phone', 'verifyStatus'], // 统一属性名为 camelCase
          where: userWhere, // 应用用户过滤条件
          required: Object.keys(userWhere).length > 0, // 如果有用户过滤条件，则强制内连接
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName'], // 统一属性名为 camelCase
        }
      ],
      attributes: ['doctorId', 'userId', 'deptId', 'title'], // 统一属性名为 camelCase
      offset,
      limit: parseInt(limit),
    });

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        list: rows,
        total: count,
      },
    });
  } catch (error) {
    console.error('获取医生列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取医生列表失败',
      data: { error: error.message }
    });
  }
};

// 根据ID获取医生详情
exports.getDoctorById = async (req, res) => {
  try {
    // 参数空值检测
    if (!req.params || !req.params.doctorId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：doctorId',
        data: null
      });
    }
    
    const { doctorId } = req.params;

    const doctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [
        {
          model: User,
          attributes: ['userId', 'username', 'phone', 'verifyStatus', 'createdAt']
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName']
        }
      ],
      attributes: ['doctorId', 'userId', 'deptId', 'title']
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在',
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: doctor
    });
  } catch (error) {
    console.error('获取医生详情失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取医生详情失败',
      data: { error: error.message }
    });
  }
};


// 创建医生
exports.createDoctor = async (req, res) => {
  try {
    const { 
      username, 
      password, 
      phone, 
      deptId, 
      title 
    } = req.body;

    // 基本验证
    if (!username || !password || !phone || !deptId || !title) {
      return res.status(400).json({
        code: 400,
        message: '请填写必填字段',
        data: null
      });
    }

    // 验证手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        code: 400,
        message: '请输入正确的手机号码',
        data: null
      });
    }

    // 检查部门是否存在
    const department = await Department.findOne({ where: { deptId: deptId } });
    if (!department) {
      return res.status(400).json({
        code: 400,
        message: '指定的部门不存在',
        data: null
      });
    }

    // 使用事务确保数据一致性
    const result = await Doctor.sequelize.transaction(async (t) => {
      // 创建用户记录
      const maxUserIdResult = await User.max('userId', { transaction: t });
      const newUserId = maxUserIdResult ? maxUserIdResult + 1 : 1;
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const user = await User.create({
        userId: newUserId,
        username,
        password: hashedPassword,
        role: 'doctor',
        phone,
        verifyStatus: 'unverified'
      }, { transaction: t });

      // 创建医生记录
      const maxDoctorIdResult = await Doctor.max('doctorId', { transaction: t });
      const newDoctorId = maxDoctorIdResult ? maxDoctorIdResult + 1 : 1;
      
      const doctor = await Doctor.create({
        doctorId: newDoctorId,
        userId: user.userId,
        deptId: deptId,
        title
      }, { transaction: t });

      return { user, doctor };
    });

    // 返回符合要求的格式
    res.status(201).json({
      code: 201,
      message: '医生创建成功',
      data: {
        userId: result.user.userId,
        username: result.user.username,
        role: result.user.role,
        verifyStatus: result.user.verifyStatus,
        doctorId: result.doctor.doctorId,
        deptId: result.doctor.deptId,
        title: result.doctor.title
      }
    });
  } catch (error) {
    // 检查是否为唯一约束错误
    if (error.name === 'SequelizeUniqueConstraintError') {
      const field = error.errors[0].path;
      if (field === 'username') {
        return res.status(409).json({
          code: 409,
          message: '用户名已存在',
          data: null
        });
      }
      if (field === 'phone') {
        return res.status(409).json({
          code: 409,
          message: '手机号已存在',
          data: null
        });
      }
    }

    console.error('创建医生失败:', error);
    res.status(500).json({
      code: 500,
      message: '创建医生失败',
      data: { error: error.message }
    });
  }
};

// 更新医生信息
exports.updateDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { title, deptId } = req.body;

    // 验证医生是否存在
    const doctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [{ model: User }]
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在',
        data: null
      });
    }

    // 如果要更改部门，验证新部门是否存在
    if (deptId && deptId !== doctor.deptId) {
      const department = await Department.findOne({ where: { deptId: deptId } });
      if (!department) {
        return res.status(400).json({
          code: 400,
          message: '指定的部门不存在',
          data: null
        });
      }
    }

    // 更新医生信息
    await Doctor.update(
      { 
        title: title || doctor.title,
        deptId: deptId || doctor.deptId
      },
      { where: { doctorId: doctorId } }
    );

    // 获取更新后的医生信息
    const updatedDoctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [
        {
          model: User,
          attributes: ['userId', 'username', 'phone', 'verifyStatus']
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName']
        }
      ]
    });

    res.status(200).json({
      code: 200,
      message: '医生信息更新成功',
      data: updatedDoctor
    });
  } catch (error) {
    console.error('更新医生信息失败:', error);
    res.status(500).json({
      code: 500,
      message: '更新医生信息失败',
      data: { error: error.message }
    });
  }
};

// 更新医生账户信息
exports.updateDoctorAccount = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { username, phone } = req.body;

    // 验证医生是否存在
    const doctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [{ model: User }]
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在',
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

    // 更新用户信息
    await User.update(
      {
        username: username || doctor.User.username,
        phone: phone || doctor.User.phone
      },
      { where: { userId: doctor.userId } }
    );

    // 获取更新后的信息
    const updatedDoctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [
        {
          model: User,
          attributes: ['userId', 'username', 'phone', 'verifyStatus']
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName']
        }
      ]
    });

    res.status(200).json({
      code: 200,
      message: '医生账户信息更新成功',
      data: updatedDoctor
    });
  } catch (error) {
    // 检查是否为唯一约束错误
    if (error.name === 'SequelizeUniqueConstraintError') {
      const field = error.errors[0].path;
      if (field === 'username') {
        return res.status(409).json({
          code: 409,
          message: '用户名已存在',
          data: null
        });
      }
      if (field === 'phone') {
        return res.status(409).json({
          code: 409,
          message: '手机号已存在',
          data: null
        });
      }
    }

    console.error('更新医生账户信息失败:', error);
    res.status(500).json({
      code: 500,
      message: '更新医生账户信息失败',
      data: { error: error.message }
    });
  }
};

// 重置医生密码
exports.resetDoctorPassword = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { newPassword } = req.body;

    // 验证医生是否存在
    const doctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [{ model: User, attributes: ['userId'] }]
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在',
        data: null
      });
    }

    // 验证新密码
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        code: 400,
        message: '密码长度不能少于6位',
        data: null
      });
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    await User.update(
      { password: hashedPassword },
      { where: { userId: doctor.User.userId } }
    );

    res.status(200).json({
      code: 200,
      message: '密码重置成功',
      data: { doctorId: doctorId }
    });
  } catch (error) {
    console.error('重置医生密码失败:', error);
    res.status(500).json({
      code: 500,
      message: '重置医生密码失败',
      data: { error: error.message }
    });
  }
};

// 删除医生
exports.deleteDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;

    // 验证医生是否存在
    const doctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [{ model: User, attributes: ['userId'] }]
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在',
        data: null
      });
    }

    // 使用事务确保数据一致性
    await Doctor.sequelize.transaction(async (t) => {
      // 删除医生记录
      await Doctor.destroy({
        where: { doctorId: doctorId },
        transaction: t
      });

      // 删除关联的用户记录
      await User.destroy({
        where: { userId: doctor.User.userId },
        transaction: t
      });
    });

    res.status(200).json({
      code: 200,
      message: '医生删除成功',
      data: { doctorId: doctorId }
    });
  } catch (error) {
    console.error('删除医生失败:', error);
    res.status(500).json({
      code: 500,
      message: '删除医生失败',
      data: { error: error.message }
    });
  }
};

// 审核医生
exports.auditDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { verifyStatus } = req.body;

    // 验证医生是否存在
    const doctor = await Doctor.findOne({
      where: { doctorId: doctorId },
      include: [{ model: User, attributes: ['userId'] }]
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在',
        data: null
      });
    }

    // 验证审核状态
    if (!['unverified', 'verified'].includes(verifyStatus)) {
      return res.status(400).json({
        code: 400,
        message: '无效的审核状态',
        data: null
      });
    }

    // 更新用户验证状态
    await User.update(
      { verifyStatus },
      { where: { userId: doctor.User.userId } }
    );

    res.status(200).json({
      code: 200,
      message: '医生审核状态更新成功',
      data: {
        doctorId: doctorId,
        verifyStatus
      }
    });
  } catch (error) {
    console.error('审核医生失败:', error);
    res.status(500).json({
      code: 500,
      message: '审核医生失败',
      data: { error: error.message }
    });
  }
};

// 根据用户ID删除医生
exports.deleteDoctorByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    // 先查找与用户ID关联的医生记录
    const doctor = await Doctor.findOne({
      where: { userId: userId }
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '未找到与该用户ID关联的医生记录',
        data: null
      });
    }

    // 使用事务确保数据一致性
    await Doctor.sequelize.transaction(async (t) => {
      // 删除医生记录
      await Doctor.destroy({
        where: { userId: userId },
        transaction: t
      });

      // 删除关联的用户记录
      await User.destroy({
        where: { userId: userId },
        transaction: t
      });
    });

    res.status(200).json({
      code: 200,
      message: '医生删除成功',
      data: { 
        userId: userId,
        doctorId: doctor.doctorId
      }
    });
  } catch (error) {
    console.error('根据用户ID删除医生失败:', error);
    res.status(500).json({
      code: 500,
      message: '删除医生失败',
      data: { error: error.message }
    });
  }
};

// 根据用户ID获取医生信息
exports.getDoctorByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const doctor = await Doctor.findOne({
      where: { userId: userId },
      include: [
        {
          model: User,
          attributes: ['userId', 'username', 'phone', 'verifyStatus', 'createdAt']
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName']
        }
      ],
      attributes: ['doctorId', 'userId', 'deptId', 'title']
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '未找到与该用户ID关联的医生记录',
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: doctor
    });
  } catch (error) {
    console.error('根据用户ID获取医生信息失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取医生信息失败',
      data: { error: error.message }
    });
  }
};

// 根据用户ID更新医生信息
exports.updateDoctorByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const { title, deptId } = req.body;

    // 验证医生是否存在
    const doctor = await Doctor.findOne({
      where: { userId: userId },
      include: [{ model: User }]
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '未找到与该用户ID关联的医生记录',
        data: null
      });
    }

    // 如果提供了新的科室ID，验证科室是否存在
    if (deptId && deptId !== doctor.deptId) {
      const department = await Department.findOne({ where: { deptId: deptId } });
      if (!department) {
        return res.status(400).json({
          code: 400,
          message: '指定的部门不存在',
          data: null
        });
      }
    }

    // 更新医生信息
    await Doctor.update(
      { 
        title: title || doctor.title,
        deptId: deptId || doctor.deptId
      },
      { where: { userId: userId } }
    );

    // 获取更新后的医生信息
    const updatedDoctor = await Doctor.findOne({
      where: { userId: userId },
      include: [
        {
          model: User,
          attributes: ['userId', 'username', 'phone', 'verifyStatus']
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName']
        }
      ]
    });

    res.status(200).json({
      code: 200,
      message: '医生信息更新成功',
      data: updatedDoctor
    });
  } catch (error) {
    console.error('根据用户ID更新医生信息失败:', error);
    res.status(500).json({
      code: 500,
      message: '更新医生信息失败',
      data: { error: error.message }
    });
  }
};