const { User, UserProfile } = require('../models');
const { Op } = require('sequelize');
const { uploadAvatar } = require('../utils/upload');
const path = require('path');
const fs = require('fs');

// 获取用户个人信息
exports.getUserProfile = async (req, res) => {
  try {
    // 从请求中获取当前登录用户的ID
    const userId = req.user.userId;

    // 查询用户和个人信息
    const [user, userProfile] = await Promise.all([
      User.findByPk(userId, {
        attributes: ['username', 'phone', 'role', 'verifyStatus', 'accountStatus']
      }),
      UserProfile.findOne({
        where: { userId },
        attributes: ['realName', 'gender', 'birthDate', 'idCard', 'avatar', 'updatedAt']
      })
    ]);

    // 构建结果
    const result = {
      ...(user ? user.toJSON() : {})
    };

    // 如果有个人资料信息，添加到结果中
    if (userProfile) {
      const profileData = userProfile.toJSON();
      Object.assign(result, profileData);
      
      // 构建头像URL
      if (profileData.avatar) {
        // 使用/uploads路径访问静态文件，这与server.js中的配置一致
        result.avatarUrl = `/uploads/avatars/${profileData.avatar}`;
      } else {
        result.avatarUrl = null;
      }
    }

    res.status(200).json({
      code: 200,
      message: '获取个人信息成功',
      data: result
    });
  } catch (error) {
    console.error('获取个人信息失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取个人信息失败',
      data: null
    });
  }
};

// 更新用户个人信息
exports.updateUserProfile = async (req, res) => {
  try {
    // 从请求中获取当前登录用户的ID
    const userId = req.user.userId;
    const { realName, gender, birthDate, idCard } = req.body;

    // 数据验证
    const validationErrors = [];

    // 验证身份证号码格式（如果提供）
    if (idCard) {
      const idCardRegex = /^[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/;
      if (!idCardRegex.test(idCard)) {
        validationErrors.push('身份证号码格式不正确');
      }
    }

    // 验证性别（如果提供）
    if (gender && !['male', 'female', 'other'].includes(gender)) {
      validationErrors.push('性别只能是male、female或other');
    }

    // 验证出生日期格式（如果提供）
    if (birthDate) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(birthDate)) {
        validationErrors.push('出生日期格式不正确，应为YYYY-MM-DD');
      }
    }

    // 如果有验证错误，返回错误信息
    if (validationErrors.length > 0) {
      return res.status(400).json({
        code: 400,
        message: validationErrors.join('; '),
        data: null
      });
    }

    // 构建更新数据对象
    const updateData = {
      realName,
      gender,
      birthDate,
      idCard,
      updatedAt: new Date()
    };

    // 移除undefined的属性
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // 先查询用户是否已有个人资料记录
    const existingProfile = await UserProfile.findOne({
      where: { userId }
    });
    
    if (existingProfile) {
      // 如果已有记录，只更新提供的字段
      await UserProfile.update(
        updateData,
        { where: { userId } }
      );
    } else {
      // 如果没有记录，创建新记录
      await UserProfile.create({
        ...updateData,
        userId
      });
    }

    // 查询更新后的个人信息和用户基本信息
    const [updatedUser, updatedProfile] = await Promise.all([
      User.findOne({
        where: { userId },
        attributes: ['phone']
      }),
      UserProfile.findOne({
        where: { userId },
        attributes: ['realName', 'gender', 'birthDate', 'idCard', 'avatar', 'updatedAt']
      })
    ]);

    // 构建结果
    const result = {
      ...(updatedUser ? updatedUser.toJSON() : {})
    };

    // 如果有个人资料信息，添加到结果中
    if (updatedProfile) {
      const profileData = updatedProfile.toJSON();
      // 如果有头像，构建完整的头像URL
      if (profileData.avatar) {
        profileData.avatarUrl = `/uploads/avatars/${profileData.avatar}`;
      }
      Object.assign(result, profileData);
    }

    res.status(200).json({
      code: 200,
      message: '更新个人信息成功',
      data: result
    });
  } catch (error) {
    console.error('更新个人信息失败:', error);
    
    // 检查是否为唯一约束错误（身份证号码重复）
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        code: 409,
        message: '身份证号码已存在',
        data: null
      });
    }

    res.status(500).json({
      code: 500,
      message: '更新个人信息失败',
      data: null
    });
  }
};

// 上传用户头像
exports.uploadAvatar = (req, res, next) => {
  // 使用中间件处理文件上传
  uploadAvatar(req, res, async (err) => {
    try {
      if (err) {
        // 处理上传错误
        return res.status(400).json({
          code: 400,
          message: err.message || '头像上传失败',
          data: null
        });
      }

      // 检查是否有文件被上传
      if (!req.file) {
        return res.status(400).json({
          code: 400,
          message: '请选择要上传的头像文件',
          data: null
        });
      }

      // 从请求中获取当前登录用户的ID
      const userId = req.user.userId;
      // 获取上传的文件名
      const avatarFilename = req.file.filename;
      // 构建头像URL路径（前端可直接访问）
      const avatarUrl = `/uploads/avatars/${avatarFilename}`;

      // 先查询用户是否已有个人资料记录
      const existingProfile = await UserProfile.findOne({
        where: { userId }
      });
      
      if (existingProfile) {
        // 如果已有记录，只更新头像字段
        await UserProfile.update(
          { avatar: avatarFilename, updatedAt: new Date() },
          { where: { userId } }
        );
      } else {
        // 如果没有记录，使用默认值创建完整记录
        await UserProfile.create({
          userId,
          avatar: avatarFilename,
          updatedAt: new Date()
          // 其他字段使用默认值（null或空字符串，取决于数据库表定义）
        });
      }

      // 返回成功响应，包含头像URL
      res.status(200).json({
        code: 200,
        message: '头像上传成功',
        data: {
          avatar: avatarFilename,
          avatarUrl: avatarUrl
        }
      });
    } catch (error) {
      console.error('头像上传失败:', error);
      res.status(500).json({
        code: 500,
        message: '头像上传失败',
        data: null
      });
    }
  });
};