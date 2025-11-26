const express = require('express');
const router = express.Router();
const userAdminController = require('../controllers/userAdminController');
const { authenticateJWT } = require('../utils/authMiddleware');

// 获取所有用户
router.get('/', authenticateJWT, userAdminController.getAllUsers);

// 根据ID获取用户详情
router.get('/:userId', authenticateJWT, userAdminController.getUserById);

// 创建用户
router.post('/', authenticateJWT, userAdminController.createUser);

// 更新用户信息
router.put('/:userId', authenticateJWT, userAdminController.updateUser);

// 重置用户密码
router.put('/:userId/password', authenticateJWT, userAdminController.resetUserPassword);

// 删除用户
router.delete('/:userId', authenticateJWT, userAdminController.deleteUser);

module.exports = router;