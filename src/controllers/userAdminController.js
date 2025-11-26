const { User, Doctor } = require('../models');
const bcrypt = require('bcrypt');
require('dotenv').config();

// 获取所有用户
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['user_id', 'username', 'role', 'phone', 'verifyStatus', 'created_at']
    });
    
    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: users
    });
  } catch (error) {
    console.error('获取用户列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取用户列表失败',
      data: { error: error.message }
    });
  }
};

// 根据ID获取用户详情
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({
      where: { user_id: userId },
      attributes: ['user_id', 'username', 'role', 'phone', 'verifyStatus', 'created_at']
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: user
    });
  } catch (error) {
    console.error('获取用户详情失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取用户详情失败',
      data: { error: error.message }
    });
  }
};

// 创建用户
exports.createUser = async (req, res) => {
  try {
    const { username, password, role, phone } = req.body;
    
    // 基本验证
    if (!username || !password || !role || !phone) {
      return res.status(400).json({
        code: 400,
        message: '请填写必填字段',
        data: null
      });
    }

    // 验证角色
    if (!['patient', 'doctor', 'admin'].includes(role)) {
      return res.status(400).json({
        code: 400,
        message: '无效的用户角色',
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
    
    // 密码加密
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // 手动生成user_id - 获取当前最大ID值
    const maxIdResult = await User.max('userId');
    const newUserId = maxIdResult ? maxIdResult + 1 : 1;
    
    // 使用事务确保数据一致性
    const result = await User.sequelize.transaction(async (t) => {
      // 创建用户
      const user = await User.create({
        userId: newUserId,
        username,
        password: hashedPassword,
        role: role || 'patient',
        phone,
        verifyStatus: 'unverified'
      }, { transaction: t });
      
      // 如果是医生角色，创建医生记录
      let doctor = null;
      if (role === 'doctor') {
        const maxDoctorIdResult = await Doctor.max('doctorId', { transaction: t });
        const newDoctorId = maxDoctorIdResult ? maxDoctorIdResult + 1 : 1;
        
        // 默认分配到第一个科室
        const defaultDeptId = 1; // 假设ID为1的科室存在
        
        doctor = await Doctor.create({
          doctorId: newDoctorId,
          userId: user.userId,
          deptId: defaultDeptId,
          title: '主治医师' // 默认职称
        }, { transaction: t });
      }
      
      return { user, doctor };
    });
    
    // 返回符合要求的格式
    if (result.doctor) {
      res.status(201).json({
        code: 201,
        message: '医生创建成功',
        data: {
          userId: result.user.userId,
          username: result.user.username,
          role: result.user.role,
          phone: result.user.phone,
          verifyStatus: result.user.verifyStatus,
          doctorId: result.doctor.doctorId,
          deptId: result.doctor.deptId,
          title: result.doctor.title
        }
      });
    } else {
      res.status(201).json({
        code: 201,
        message: '用户创建成功',
        data: {
          userId: result.user.userId,
          username: result.user.username,
          role: result.user.role,
          phone: result.user.phone,
          verifyStatus: result.user.verifyStatus
        }
      });
    }
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
    
    // 添加详细错误日志以帮助调试
    console.error('创建用户失败错误详情:', error);
    res.status(500).json({
      code: 500,
      message: '创建用户失败',
      data: { error: error.message }
    });
  }
};

// 更新用户信息
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, role, phone, verifyStatus } = req.body;

    // 验证用户是否存在
    const user = await User.findOne({
      where: { user_id: userId },
      attributes: ['user_id', 'username', 'role', 'phone', 'verifyStatus']
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }

    // 验证角色（如果提供）
    if (role && !['patient', 'doctor', 'admin'].includes(role)) {
      return res.status(400).json({
        code: 400,
        message: '无效的用户角色',
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

    // 验证审核状态（如果提供）
    if (verifyStatus && !['unverified', 'verified'].includes(verifyStatus)) {
      return res.status(400).json({
        code: 400,
        message: '无效的审核状态',
        data: null
      });
    }

    // 更新用户信息
    await User.update(
      {
        username: username || user.username,
        role: role || user.role,
        phone: phone || user.phone,
        verifyStatus: verifyStatus || user.verifyStatus
      },
      { where: { user_id: userId } }
    );

    // 获取更新后的用户信息
    const updatedUser = await User.findOne({
      where: { user_id: userId },
      attributes: ['user_id', 'username', 'role', 'phone', 'verifyStatus', 'created_at']
    });

    res.status(200).json({
      code: 200,
      message: '用户信息更新成功',
      data: updatedUser
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

    console.error('更新用户信息失败:', error);
    res.status(500).json({
      code: 500,
      message: '更新用户信息失败',
      data: { error: error.message }
    });
  }
};

// 重置用户密码
exports.resetUserPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    // 验证用户是否存在
    const user = await User.findOne({
      where: { user_id: userId },
      attributes: ['user_id', 'username']
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
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
      { where: { user_id: userId } }
    );

    res.status(200).json({
      code: 200,
      message: '密码重置成功',
      data: { user_id: userId }
    });
  } catch (error) {
    console.error('重置用户密码失败:', error);
    res.status(500).json({
      code: 500,
      message: '重置用户密码失败',
      data: { error: error.message }
    });
  }
};

// 删除用户
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    // 验证用户是否存在
    const user = await User.findOne({
      where: { userId: userId },
      attributes: ['userId', 'username', 'role']
    });

    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }

    console.log(`正在删除用户: ${user.username}, 角色: ${user.role}, ID: ${user.userId}`);

    // 使用事务确保数据一致性
    await User.sequelize.transaction(async (t) => {
      // 如果用户是医生，先删除关联的医生记录
      if (user.role === 'doctor') {
        console.log('用户是医生，正在删除医生记录...');
        const deletedDoctorCount = await Doctor.destroy({
          where: { userId: userId },
          transaction: t
        });
        console.log(`删除了 ${deletedDoctorCount} 条医生记录`);
      }
      
      // 删除用户记录
      console.log('正在删除用户记录...');
      const deletedUserCount = await User.destroy({
        where: { userId: userId },
        transaction: t
      });
      console.log(`删除了 ${deletedUserCount} 条用户记录`);
    });

    res.status(200).json({
      code: 200,
      message: '用户删除成功',
      data: { 
        userId: userId,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('删除用户失败:', error);
    res.status(500).json({
      code: 500,
      message: '删除用户失败',
      data: { error: error.message }
    });
  }
};