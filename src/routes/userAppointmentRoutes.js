const express = require('express');
const router = express.Router();
const userAppointmentController = require('../controllers/userAppointmentController');
const { authenticateJWT } = require('../utils/authMiddleware');
const { checkBlacklist } = require('../utils/blacklistMiddleware');
const { appointmentLimiter, createRateLimiter } = require('../utils/rateLimitMiddleware');
const { verifyCaptcha } = require('../utils/captchaMiddleware');

// 创建签到专用的限流中间件，限制频率
const signInLimiter = createRateLimiter({
  maxRequests: 5, // 1分钟内最多5次请求
  windowMs: 60000, // 1分钟时间窗口
  action: 'sign_in' // 操作类型标识
});

// 获取科室列表 (新增功能：筛选第一步)
router.get('/appointments/departments', userAppointmentController.getAllDepartments); 

// 根据科室ID获取医生列表 (新增功能：筛选第二步)
router.get('/appointments/doctors', userAppointmentController.getDoctorsByDept);

// 查询可预约的排班列表 - 不需要认证，用于前端展示可选的排班时间
router.get('/available-schedules', userAppointmentController.getAvailableSchedules);

// 签到验证接口 - 不需要认证，添加限流措施
router.post('/verify-sign-in', signInLimiter, userAppointmentController.verifySignIn);

// 创建预约（挂号）- 直接应用所有必要的中间件，确保执行顺序正确
router.post('/appointments', authenticateJWT, checkBlacklist, appointmentLimiter, userAppointmentController.createAppointment);

// 应用认证中间件和黑名单检查中间件到后续路由
router.use(authenticateJWT, checkBlacklist);

// 查询用户的预约列表
router.get('/appointments', userAppointmentController.getUserAppointments);

// 查询预约详情
router.get('/appointments/:apptId', userAppointmentController.getAppointmentDetail);

// 取消预约
router.put('/appointments/:apptId/cancel', userAppointmentController.cancelAppointment);

module.exports = router;