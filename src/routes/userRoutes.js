const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const userProfileController = require('../controllers/userProfileController');
const { authenticateJWT } = require('../utils/authMiddleware'); // 导入JWT认证中间件
const { checkBlacklist } = require('../utils/blacklistMiddleware');

// 获取所有用户
router.get('/', userController.getAllUsers);

// 创建用户（注册）
router.post('/', userController.createUser);

// 用户登录
router.post('/login', userController.loginUser);

// 用户身份核验（需要JWT认证和账户状态检查）
router.post('/verify', authenticateJWT, checkBlacklist, userController.verifyUser);

// 发送验证码（忘记密码第一步）
router.post('/send-code', userController.sendVerificationCode);

// 验证验证码（忘记密码第二步）
router.post('/verify-code', userController.verifyCode);

// 重置密码（忘记密码第三步）
router.post('/reset-password', userController.resetPassword);

// 获取用户个人信息（需要JWT认证）
router.get('/profile', authenticateJWT, checkBlacklist, userProfileController.getUserProfile);

// 更新用户个人信息（需要JWT认证）
router.put('/profile', authenticateJWT, checkBlacklist, userProfileController.updateUserProfile);

// 上传用户头像（需要JWT认证）
router.post('/profile/avatar', authenticateJWT, checkBlacklist, userProfileController.uploadAvatar);

// 修改密码（需要JWT认证）
router.put('/change-password', authenticateJWT, checkBlacklist, userController.changePassword);

module.exports = router;