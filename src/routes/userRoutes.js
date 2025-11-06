const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticateJWT = require('../utils/authMiddleware'); // 导入JWT认证中间件

// 获取所有用户
router.get('/', userController.getAllUsers);

// 创建用户（注册）
router.post('/', userController.createUser);

// 用户登录
router.post('/login', userController.loginUser);

// 用户身份核验（需要JWT认证）
router.post('/verify', authenticateJWT, userController.verifyUser);

// 发送验证码（忘记密码第一步）
router.post('/send-code', userController.sendVerificationCode);

// 验证验证码（忘记密码第二步）
router.post('/verify-code', userController.verifyCode);

// 重置密码（忘记密码第三步）
router.post('/reset-password', userController.resetPassword);

module.exports = router;