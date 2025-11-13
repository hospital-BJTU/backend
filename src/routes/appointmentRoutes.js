const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');
const authMiddleware = require('../utils/authMiddleware');

// 查询可预约的排班列表 - 不需要认证，用于前端展示可选的排班时间
router.get('/available-schedules', appointmentController.getAvailableSchedules);

// 对需要认证的路由应用中间件
router.use(authMiddleware);

// 创建预约（挂号）- 前端点击预约按钮时调用此接口
router.post('/', appointmentController.createAppointment);

// 医生端 - 查询本人排班队列
router.get('/doctor/queue', appointmentController.getDoctorQueue);

// 查询用户的预约列表
router.get('/user', appointmentController.getUserAppointments);

// 查询预约详情
router.get('/:apptId', appointmentController.getAppointmentDetail);

// 取消预约
router.put('/:apptId/cancel', appointmentController.cancelAppointment);

// 医生端 - 叫号与过号（需JWT认证，控制器内做角色校验）
router.put('/:apptId/call', appointmentController.callAppointmentByDoctor);
router.put('/:apptId/miss', appointmentController.markAppointmentMissedByDoctor);
router.put('/:apptId/complete', appointmentController.markAppointmentCompletedByDoctor);

module.exports = router;