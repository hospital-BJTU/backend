// routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
// 假设您的认证中间件在 utils/authMiddleware.js
const { authenticateJWT, isAdmin } = require('../utils/authMiddleware'); 

// 应用JWT认证中间件
router.use(authenticateJWT);

// 应用管理员认证中间件到所有 Admin 路由
// ⚠️ 确保您的 isAdmin 中间件能验证 req.user 中的角色是否为 'admin'
router.use(isAdmin); 

// =========================================================
// 排班管理路由
// =========================================================

// 1. 查询待审核排班列表
router.get('/schedules/pending', adminController.getPendingSchedules); 

// 2. 审核/拒绝排班 (将在下一步实现)
router.put('/schedules/:scheduleId/audit', adminController.auditSchedule); 

// 3. 管理员删除排班记录 (用于清理 pending/rejected 状态的排班)
router.delete('/schedules/:scheduleId', adminController.deleteScheduleByAdmin);

// 4. 查询医生请假请求列表 (新增)
router.get('/schedules/leave-requests', adminController.getLeaveRequests);

// 5. 批准医生请假请求 (新增)
router.put('/schedules/:scheduleId/approve-leave', adminController.approveLeaveRequest);

// 6. 拒绝医生请假请求 (新增)
router.put('/schedules/:scheduleId/reject-leave', adminController.rejectLeaveRequest);

// =========================================================
// 其他管理员路由 (占位)
// =========================================================

// router.get('/users', adminController.getUsers); 
// router.post('/departments', adminController.createDepartment);
router.get('/departments', adminController.getDepartments);
router.get('/departments/:deptId', adminController.getDepartmentById);
router.post('/departments', adminController.createDepartment);
router.put('/departments/:deptId', adminController.updateDepartment);
router.delete('/departments/:deptId', adminController.deleteDepartment);

// =========================================================
// 用户管理路由
// =========================================================

// 设置用户状态（封禁/解封账号等）
router.put('/users/:userId/status', adminController.setUserAccountStatus);
module.exports = router;