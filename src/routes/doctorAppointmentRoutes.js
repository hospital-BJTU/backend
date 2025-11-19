const express = require('express');
const router = express.Router();
const doctorAppointmentController = require('../controllers/doctorAppointmentController');
const authMiddleware = require('../utils/authMiddleware');

// 应用认证中间件
router.use(authMiddleware);

// 查询有排班的日期 (日历概览)
router.get('/schedules/calendar', doctorAppointmentController.getScheduledDates);

// 查询指定日期的排班详情
router.get('/schedules/details', doctorAppointmentController.getScheduleDetailsByDate);

// 医生请假（取消排班）
router.put('/schedules/:scheduleId/leave', doctorAppointmentController.requestLeaveForSchedule);

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

// 医生端 - 提报排班计划 (新增)
router.post('/schedules/propose', doctorAppointmentController.proposeSchedule);

module.exports = router;