const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');
const { authenticateJWT } = require('../utils/authMiddleware');

// 获取所有医生
router.get('/', doctorController.getAllDoctors);

// 根据ID获取医生详情
router.get('/:doctorId', doctorController.getDoctorById);

// 创建医生
router.post('/', doctorController.createDoctor);

// 更新医生信息
router.put('/:doctorId', doctorController.updateDoctor);

// 更新医生账户信息
router.put('/:doctorId/account', doctorController.updateDoctorAccount);

// 重置医生密码
router.put('/:doctorId/password', doctorController.resetDoctorPassword);

// 删除医生
router.delete('/:doctorId', doctorController.deleteDoctor);

// 根据用户ID删除医生
router.delete('/user/:userId', doctorController.deleteDoctorByUserId);

// 审核医生
router.put('/:doctorId/audit', doctorController.auditDoctor);

// 根据用户ID获取医生信息
router.get('/user/:userId', doctorController.getDoctorByUserId);

// 根据用户ID更新医生信息
router.put('/user/:userId', doctorController.updateDoctorByUserId);

module.exports = router;