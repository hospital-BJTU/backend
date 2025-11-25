const express = require('express');
const router = express.Router();
const userAppointmentController = require('../controllers/userAppointmentController');
const { authenticateJWT } = require('../utils/authMiddleware');

// 获取科室列表 (新增功能：筛选第一步)
router.get('/appointments/departments', userAppointmentController.getAllDepartments); 

// 根据科室ID获取医生列表 (新增功能：筛选第二步)
router.get('/appointments/doctors', userAppointmentController.getDoctorsByDept);

// 查询可预约的排班列表 - 不需要认证，用于前端展示可选的排班时间
router.get('/available-schedules', userAppointmentController.getAvailableSchedules);

// 应用认证中间件到后续路由
router.use(authenticateJWT);

// 创建预约（挂号）
router.post('/appointments', userAppointmentController.createAppointment);

// 查询用户的预约列表
router.get('/appointments', userAppointmentController.getUserAppointments);

// 查询预约详情
router.get('/appointments/:apptId', userAppointmentController.getAppointmentDetail);

// 取消预约
router.put('/appointments/:apptId/cancel', userAppointmentController.cancelAppointment);

module.exports = router;