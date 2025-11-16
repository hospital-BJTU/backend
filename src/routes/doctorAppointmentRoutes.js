const express = require('express');
const router = express.Router();
const doctorAppointmentController = require('../controllers/doctorAppointmentController');
const authMiddleware = require('../utils/authMiddleware');

// 应用认证中间件
router.use(authMiddleware);

// 获取医生当天排班状态和叫号信息
router.get('/schedule-status', doctorAppointmentController.getDoctorScheduleStatus);

// 获取医生端就诊队列
router.get('/queue', doctorAppointmentController.getDoctorQueue);

// 医生端 - 叫号
router.put('/appointments/:apptId/call', doctorAppointmentController.callAppointmentByDoctor);

// 医生端 - 标记过号
router.put('/appointments/:apptId/miss', doctorAppointmentController.markAppointmentMissedByDoctor);

// 医生端 - 标记接诊完成
router.put('/appointments/:apptId/complete', doctorAppointmentController.markAppointmentCompletedByDoctor);

module.exports = router;