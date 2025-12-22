const express = require('express');
const router = express.Router();
const miniprogramController = require('../controllers/miniprogramController');

// 小程序接口：获取所有科室列表
router.get('/departments', miniprogramController.getAllDepartments);

// 小程序接口：根据科室ID获取医生列表
router.get('/doctors', miniprogramController.getDoctorsByDepartment);

// 小程序接口：获取医生详情
router.get('/doctor-detail', miniprogramController.getDoctorDetail);

// 小程序接口：获取指定日期的排班医生列表
router.get('/doctors-by-date', miniprogramController.getDoctorsByDate);

// 小程序接口：获取医生在指定日期范围内的排班信息
router.get('/doctor-schedules', miniprogramController.getDoctorSchedules);

// 小程序接口：获取指定日期的号源信息
router.get('/available-slots', miniprogramController.getAvailableSlotsByDate);

module.exports = router;