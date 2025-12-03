// controllers/adminController.js

const { Appointment, Schedule, Doctor, Department, User, CallLog, AuditLog } = require('../models');
const { Op } = require('sequelize');

// 管理员端：设置用户账户状态
const setUserAccountStatus = async (req, res) => {
    try {
        // 参数空值检测
        if (!req.params || !req.params.userId) {
            return res.status(400).json({ code: 400, message: '缺少必要参数：userId' });
        }
        
        // 请求体存在性检测
        if (!req.body) {
            return res.status(400).json({ code: 400, message: '请求体不能为空' });
        }
        
        const { userId } = req.params;
        const { status, reason } = req.body;
        
        // 参数验证
        const parsedUserId = parseInt(userId, 10);
        if (isNaN(parsedUserId)) {
            return res.status(400).json({ code: 400, message: '用户ID格式错误' });
        }
        
        // 验证状态值
        const validStatuses = ['active', 'banned', 'temp_locked'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ code: 400, message: '无效的状态值，必须是 active、banned 或 temp_locked' });
        }
        
        // 当状态为banned或temp_locked时，必须提供原因
        if (['banned', 'temp_locked'].includes(status) && !reason) {
            return res.status(400).json({ code: 400, message: '禁用或临时锁定账户必须提供原因' });
        }
        
        // 查找用户
        const user = await User.findByPk(parsedUserId);
        if (!user) {
            return res.status(404).json({ code: 404, message: '用户不存在' });
        }
        
        // 开始事务
        const transaction = await User.sequelize.transaction();
        
        try {
            // 更新用户状态
            await user.update({ 
                accountStatus: status,
                // 可以添加更多状态相关字段，如锁定时间、解锁时间等
                // lockTime: status === 'temp_locked' ? new Date() : null,
                // unlockTime: status === 'temp_locked' ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null // 临时锁定24小时示例
            }, { transaction });
            
            // 记录操作日志（使用智能方法，支持新旧字段）
            await AuditLog.createSmartLog({
                actionType: 'user_status_change',
                targetId: parsedUserId,
                adminId: req.user?.userId || 1, // 假设管理员ID从请求中获取
                actionResult: status,
                reason: reason,
                details: JSON.stringify({
                    oldStatus: user.accountStatus,
                    newStatus: status
                }),
                actionTime: new Date()
            }, { transaction });
            
            // 提交事务
            await transaction.commit();
            
            let statusMessage;
            switch(status) {
                case 'active':
                    statusMessage = '启用';
                    break;
                case 'banned':
                    statusMessage = '禁用';
                    break;
                case 'temp_locked':
                    statusMessage = '临时锁定';
                    break;
            }
            
            return res.status(200).json({
                code: 200,
                message: `用户账户${statusMessage}成功`,
                data: {
                    userId: parsedUserId,
                    newStatus: status,
                    reason: reason
                }
            });
            
        } catch (error) {
            // 回滚事务
            await transaction.rollback();
            throw error;
        }
        
    } catch (error) {
        console.error('setUserAccountStatus 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};


//管理员端：查询待审核排班列表 
exports.getPendingSchedules = async (req, res) => {
    // 假设此处已通过路由中间件验证管理员身份
    try {
        const { doctorId, deptId, page = 1, limit = 10 } = req.query;
        
        // 动态构建查询条件
        const whereClause = {
            auditStatus: 'pending' // 核心筛选条件
        };
        if (doctorId) whereClause.doctorId = doctorId; 
        
        const offset = (parseInt(page) - 1) * parseInt(limit);

        // 查找排班，并关联医生、科室和用户（获取医生姓名）
        const schedules = await Schedule.findAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: offset,
            include: [
                {
                    model: Doctor,
                    // 如果有 deptId，则在 Doctor 模型上筛选
                    where: deptId ? { deptId } : {}, 
                    // 注意：这里的字段名 (deptId, doctorId, etc.) 需与您的 Sequelize 模型定义保持一致
                    include: [
                        { model: Department, attributes: ['deptName'] }, // 只查询科室名称
                        { model: User, attributes: ['username', 'userId'] } // 关联用户获取医生姓名
                    ]
                }
            ],
            // 默认按排班日期升序排列
            order: [['scheduleDate', 'ASC'], ['timeSlot', 'ASC']] 
        });
        
        // 格式化输出 (简化结构，只包含核心信息)
        const formattedSchedules = schedules.map(schedule => ({
            scheduleId: schedule.scheduleId,
            scheduleDate: schedule.scheduleDate,
            timeSlot: schedule.timeSlot,
            maxCount: schedule.maxCount,
            auditStatus: schedule.auditStatus,
            doctor: {
                doctorId: schedule.Doctor.doctorId,
                doctorName: schedule.Doctor.User.username,
                departmentName: schedule.Doctor.Department.deptName
            }
        }));

        return res.status(200).json({
            code: 200,
            message: '查询待审核排班成功',
            data: formattedSchedules
        });
    } catch (error) {
        console.error('getPendingSchedules 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};
//

// 管理员端：审核/拒绝排班请求 
exports.auditSchedule = async (req, res) => {
    // 参数空值检测
    if (!req.params || !req.params.scheduleId) {
        return res.status(400).json({ code: 400, message: '缺少必要参数：scheduleId' });
    }
    
    // 请求体存在性检测
    if (!req.body) {
        return res.status(400).json({ code: 400, message: '请求体不能为空' });
    }
    
    const { scheduleId } = req.params;
    const { newStatus, reason } = req.body; // newStatus: 'approved' 或 'rejected'
    
    // 1. 基础校验 (假设管理员身份已在路由中间件中验证)
    const parsedScheduleId = parseInt(scheduleId, 10);
    if (isNaN(parsedScheduleId)) {
        return res.status(400).json({ code: 400, message: '排班ID格式错误' });
    }

    if (!['approved', 'rejected'].includes(newStatus)) {
        return res.status(400).json({ code: 400, message: '无效的审核状态，必须是 approved 或 rejected' });
    }

    if (newStatus === 'rejected' && !reason) {
        return res.status(400).json({ code: 400, message: '拒绝排班必须提供理由' });
    }

    const transaction = await Schedule.sequelize.transaction();
    try {
        // 2. 查找排班，并确保其状态为 pending
        const schedule = await Schedule.findOne({
            where: {
                scheduleId: parsedScheduleId,
                auditStatus: 'pending'
            },
            transaction
        });

        if (!schedule) {
            await transaction.rollback();
            // 如果排班不存在，或已被审核过 (audit_status != 'pending')
            return res.status(404).json({ code: 404, message: '未找到待审核的排班记录，或该记录已审核' });
        }

        // 3. 更新审核状态
        await schedule.update({
            auditStatus: newStatus,
            // 可以在 Schedule 模型中增加一个 audit_reason 字段来记录拒绝理由
            // audit_reason: newStatus === 'rejected' ? reason : null,
            // audit_by: req.user.userId, // 记录操作的管理员ID (可选)
            // audit_time: new Date()
        }, { transaction });

        // 4. 记录审核日志（使用智能方法，支持新旧字段）
        await AuditLog.createSmartLog({
            actionType: 'schedule_audit',
            targetId: parsedScheduleId,
            adminId: req.user?.userId || 1, // 假设管理员ID从请求中获取，默认值为1（系统管理员）
            actionResult: newStatus,
            reason: newStatus === 'rejected' ? reason : null,
            details: JSON.stringify({
                oldStatus: schedule.auditStatus,
                newStatus: newStatus
            }),
            actionTime: new Date()
        }, {
            transaction
        });

        // 4. [可选] 如果排班被拒绝，可以通知医生

        await transaction.commit();
        
        const actionMessage = newStatus === 'approved' ? '批准' : '拒绝';

        return res.status(200).json({
            code: 200,
            message: `排班审核${actionMessage}成功`,
            data: {
                scheduleId: parsedScheduleId,
                auditStatus: newStatus,
                reason: newStatus === 'rejected' ? reason : null
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('auditSchedule 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};

// 管理员端：查询请假请求列表 
exports.getLeaveRequests = async (req, res) => {
    try {
        const { doctorId, deptId, page = 1, limit = 10 } = req.query;
        
        const whereClause = {
            auditStatus: 'leave_requested' // 核心筛选条件：请假申请中
        };
        if (doctorId) whereClause.doctorId = doctorId; 
        
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const schedules = await Schedule.findAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: offset,
            include: [
                {
                    model: Doctor,
                    where: deptId ? { deptId } : {}, 
                    include: [
                        { model: Department, attributes: ['deptName'] },
                        { model: User, attributes: ['username', 'userId'] }
                    ]
                }
            ],
            order: [['scheduleDate', 'ASC'], ['timeSlot', 'ASC']] 
        });
        
        const formattedRequests = schedules.map(schedule => ({
            scheduleId: schedule.scheduleId,
            scheduleDate: schedule.scheduleDate,
            timeSlot: schedule.timeSlot,
            maxCount: schedule.maxCount,
            auditStatus: schedule.auditStatus,
            // leaveReason: schedule.leave_reason, // 如果模型有记录请假原因的字段
            doctor: {
                doctorId: schedule.Doctor.doctorId,
                doctorName: schedule.Doctor.User.username,
                departmentName: schedule.Doctor.Department.deptName
            }
        }));

        return res.status(200).json({
            code: 200,
            message: '查询请假申请列表成功',
            data: formattedRequests
        });
    } catch (error) {
        console.error('getLeaveRequests 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};

// 管理员端：删除排班记录 (仅限未生效或已拒绝的排班)
exports.deleteScheduleByAdmin = async (req, res) => {
    // 参数空值检测
    if (!req.params || !req.params.scheduleId) {
        return res.status(400).json({ code: 400, message: '缺少必要参数：scheduleId' });
    }
    
    const { scheduleId } = req.params;
    const parsedScheduleId = parseInt(scheduleId, 10);
    
    if (isNaN(parsedScheduleId)) {
        return res.status(400).json({ code: 400, message: '排班ID格式错误' });
    }

    const transaction = await Schedule.sequelize.transaction();
    try {
        const schedule = await Schedule.findOne({ where: { scheduleId: parsedScheduleId }, transaction });

        if (!schedule) {
            await transaction.rollback();
            return res.status(404).json({ code: 404, message: '未找到该排班记录' });
        }
        
        // 1. 核心状态校验：不允许删除已批准且可能被预约的排班
        if (schedule.auditStatus === 'approved') {
            await transaction.rollback();
            return res.status(403).json({ code: 403, message: '该排班已通过审核，如需取消请走“请假审核”流程' });
        }
        
        // 2. 执行删除
        const deletedRows = await Schedule.destroy({
            where: { scheduleId: parsedScheduleId },
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            code: 200,
            message: `排班记录 (ID: ${parsedScheduleId}) 删除成功`
        });

    } catch (error) {
        await transaction.rollback();
        console.error('deleteScheduleByAdmin 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};

// 管理员端：批准医生请假请求
exports.approveLeaveRequest = async (req, res) => {
    // 参数空值检测
    if (!req.params || !req.params.scheduleId) {
        return res.status(400).json({ code: 400, message: '缺少必要参数：scheduleId' });
    }
    
    const { scheduleId } = req.params;
    const parsedScheduleId = parseInt(scheduleId, 10);
    
    if (isNaN(parsedScheduleId)) {
        return res.status(400).json({ code: 400, message: '排班ID格式错误' });
    }

    const transaction = await Schedule.sequelize.transaction();
    let cancelledAppointmentCount = 0;

    try {
        // 1. 查找排班并校验状态：必须是 leave_requested
        const schedule = await Schedule.findOne({
            where: {
                scheduleId: parsedScheduleId,
                auditStatus: 'leave_requested'
            },
            transaction
        });

        if (!schedule) {
            await transaction.rollback();
            return res.status(404).json({ code: 404, message: '未找到待审核的请假申请' });
        }
        
        // 2. 查找所有待就诊/已叫号的预约
        const existingAppointments = await Appointment.findAll({
            where: {
                scheduleId: parsedScheduleId,
                isValid: 1,
                status: { [Op.in]: ['pending', 'called'] }
            },
            transaction
        });
        
        cancelledAppointmentCount = existingAppointments.length;

        if (cancelledAppointmentCount > 0) {
            // 3. 强制取消相关预约
            await Appointment.update({
                status: 'cancelled',
                // 可选：cancel_reason: '管理员批准医生请假'
            }, {
                where: {
                    scheduleId: parsedScheduleId,
                    isValid: 1,
                    status: { [Op.in]: ['pending', 'called'] }
                },
                transaction
            });
            console.warn(`管理员批准请假，强制取消了 ${cancelledAppointmentCount} 个预约: Schedule ID ${parsedScheduleId}`);
            // ⚠️ 实际项目中，这里需要添加通知服务 (短信/站内信)
        }

        // 4. 更新排班状态：可预约数归零， audit_status 设为 'cancelled' (终结状态)
        await schedule.update({
            availableCount: 0,
            auditStatus: 'cancelled' // 终结状态，从患者查询列表中排除
        }, { transaction });

        // 5. 记录请假审核日志（批准）
        await AuditLog.create({
            actionType: 'schedule_audit',
            targetId: parsedScheduleId,
            adminId: req.user?.userId || 1, // 假设管理员ID从请求中获取，默认值为1（系统管理员）
            actionResult: 'approved', // 批准请假
            reason: '医生请假申请已批准',
            details: JSON.stringify({
                oldStatus: schedule.auditStatus,
                newStatus: 'cancelled'
            }),
            actionTime: new Date()
        }, {
            transaction
        });

        await transaction.commit();

        return res.status(200).json({
            code: 200,
            message: `医生请假批准成功。排班已取消，共强制取消 ${cancelledAppointmentCount} 个有效预约。`,
            data: {
                scheduleId: parsedScheduleId,
                newStatus: 'cancelled',
                cancelledAppointments: cancelledAppointmentCount
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('approveLeaveRequest 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};

// 管理员端：拒绝医生请假请求
exports.rejectLeaveRequest = async (req, res) => {
    // 参数空值检测
    if (!req.params || !req.params.scheduleId) {
        return res.status(400).json({ code: 400, message: '缺少必要参数：scheduleId' });
    }
    
    // 请求体存在性检测
    if (!req.body) {
        return res.status(400).json({ code: 400, message: '请求体不能为空' });
    }
    
    const { scheduleId } = req.params;
    const { reason } = req.body; // 拒绝理由
    const parsedScheduleId = parseInt(scheduleId, 10);
    
    if (isNaN(parsedScheduleId)) {
        return res.status(400).json({ code: 400, message: '排班ID格式错误' });
    }
    
    if (!reason || reason.trim() === '') {
        return res.status(400).json({ code: 400, message: '拒绝请假必须提供理由' });
    }

    const transaction = await Schedule.sequelize.transaction();
    try {
        // 1. 查找排班并校验状态：必须是 leave_requested
        const schedule = await Schedule.findOne({
            where: {
                scheduleId: parsedScheduleId,
                auditStatus: 'leave_requested'
            },
            transaction
        });

        if (!schedule) {
            await transaction.rollback();
            return res.status(404).json({ code: 404, message: '未找到待审核的请假申请' });
        }
        
        // 2. 更新排班状态：恢复为 'approved'
        await schedule.update({
            auditStatus: 'approved', // 恢复到已批准状态
            // 可选：记录拒绝理由
            // leave_reject_reason: reason
        }, { transaction });

        // 3. 记录请假审核日志（拒绝）
        await AuditLog.create({
            actionType: 'schedule_audit',
            targetId: parsedScheduleId,
            adminId: req.user?.userId || 1, // 假设管理员ID从请求中获取，默认值为1（系统管理员）
            actionResult: 'rejected', // 拒绝请假
            reason: reason,
            details: JSON.stringify({
                oldStatus: schedule.auditStatus,
                newStatus: 'approved'
            }),
            actionTime: new Date()
        }, {
            transaction
        });

        await transaction.commit();
        
        // 3. [可选] 通知医生请假被拒绝

        return res.status(200).json({
            code: 200,
            message: '医生请假请求已拒绝，排班已恢复至可预约状态',
            data: {
                scheduleId: parsedScheduleId,
                newStatus: 'approved',
                rejectReason: reason
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('rejectLeaveRequest 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};

// 管理员端：设置用户状态（用于封禁/解封账号等操作）
exports.setUserStatus = async (req, res) => {
    // 参数空值检测
    if (!req.params || !req.params.userId) {
        return res.status(400).json({ code: 400, message: '缺少必要参数：userId', data: null });
    }
    
    // 请求体存在性检测
    if (!req.body) {
        return res.status(400).json({ code: 400, message: '请求体不能为空', data: null });
    }
    
    const { userId } = req.params;
    const { status, reason } = req.body;
    const parsedUserId = parseInt(userId, 10);
    
    // 参数校验
    if (isNaN(parsedUserId)) {
        return res.status(400).json({ code: 400, message: '用户ID格式错误', data: null });
    }
    
    // 定义允许的状态值
    const allowedStatuses = ['active', 'banned', 'temp_locked', 'pending'];
    if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({ code: 400, message: `无效的状态值，必须是以下之一：${allowedStatuses.join(', ')}`, data: null });
    }
    
    // 对于封禁操作，要求提供理由
    if (status === 'banned' && (!reason || reason.trim() === '')) {
        return res.status(400).json({ code: 400, message: '封禁账号必须提供理由', data: null });
    }

    const transaction = await User.sequelize.transaction();
    try {
        // 查找用户
        const user = await User.findByPk(parsedUserId, { transaction });
        if (!user) {
            await transaction.rollback();
            return res.status(404).json({ code: 404, message: '用户不存在', data: null });
        }
        
        // 记录原状态
        const oldStatus = user.accountStatus || 'active';
        
        // 更新用户状态
        await user.update(
            { 
                accountStatus: status,
                // 如果是临时锁定，可以设置锁定到期时间
                // lockUntil: status === 'temp_locked' ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null
            }, 
            { transaction }
        );
        
        // 记录操作日志
        await AuditLog.create({
            userId: parsedUserId,
            adminId: req.user?.userId || 1, // 记录操作的管理员ID
            auditResult: status,
            reason: reason || `用户状态从 ${oldStatus} 变更为 ${status}`,
            auditTime: new Date()
        }, {
            transaction
        });
        
        await transaction.commit();
        
        // 生成操作描述消息
        const statusActions = {
            'active': '解封',
            'banned': '永久封禁',
            'temp_locked': '临时锁定',
            'pending': '设为待审核'
        };
        
        return res.status(200).json({
            code: 200,
            message: `用户账号${statusActions[status] || '状态更新'}成功`,
            data: {
                userId: parsedUserId,
                oldStatus: oldStatus,
                newStatus: status,
                reason: reason
            }
        });

    } catch (error) {
        await transaction.rollback();
        console.error('setUserStatus 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
    }
};

module.exports = {
    getPendingSchedules: exports.getPendingSchedules,
    auditSchedule: exports.auditSchedule,
    deleteScheduleByAdmin: exports.deleteScheduleByAdmin,
    getLeaveRequests: exports.getLeaveRequests,
    approveLeaveRequest: exports.approveLeaveRequest,
    rejectLeaveRequest: exports.rejectLeaveRequest,
    setUserStatus: exports.setUserStatus,
    getDepartments: async (req, res) => {
        try {
            const { page = 1, limit = 10, keyword } = req.query;
            const where = keyword ? { deptName: { [Op.like]: `%${keyword}%` } } : {};
            const offset = (parseInt(page) - 1) * parseInt(limit);
            const { rows, count } = await Department.findAndCountAll({ where, limit: parseInt(limit), offset });
            return res.status(200).json({ code: 200, message: '查询成功', data: { list: rows, total: count, page: parseInt(page), limit: parseInt(limit) } });
        } catch (error) {
            return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
        }
    },
    getDepartmentById: async (req, res) => {
        try {
            // 参数空值检测
            if (!req.params || !req.params.deptId) {
                return res.status(400).json({ code: 400, message: '缺少必要参数：deptId', data: null });
            }
            
            const deptId = parseInt(req.params.deptId, 10);
            if (isNaN(deptId)) return res.status(400).json({ code: 400, message: '科室ID格式错误', data: null });
            const dept = await Department.findByPk(deptId);
            if (!dept) return res.status(404).json({ code: 404, message: '科室不存在', data: null });
            return res.status(200).json({ code: 200, message: '查询成功', data: dept });
        } catch (error) {
            return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
        }
    },
    createDepartment: async (req, res) => {
        try {
            // 请求体存在性检测
            if (!req.body) {
                return res.status(400).json({ code: 400, message: '请求体不能为空', data: null });
            }
            
            const nameInput = (req.body.dept_name || req.body.deptName || '').trim();
            if (!nameInput) return res.status(400).json({ code: 400, message: '科室名称不能为空', data: null });
            const existing = await Department.findOne({ where: { deptName: nameInput } });
            if (existing) return res.status(409).json({ code: 409, message: '科室名称已存在', data: null });
            const dept = await Department.create({ deptName: nameInput });
            return res.status(201).json({ code: 201, message: '创建成功', data: { dept_id: dept.deptId, dept_name: dept.deptName } });
        } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
                return res.status(409).json({ code: 409, message: '科室名称已存在', data: null });
            }
            return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
        }
    },
    updateDepartment: async (req, res) => {
        try {
            // 参数空值检测
            if (!req.params || !req.params.deptId) {
                return res.status(400).json({ code: 400, message: '缺少必要参数：deptId', data: null });
            }
            
            // 请求体存在性检测
            if (!req.body) {
                return res.status(400).json({ code: 400, message: '请求体不能为空', data: null });
            }
            
            const deptId = parseInt(req.params.deptId, 10);
            if (isNaN(deptId)) return res.status(400).json({ code: 400, message: '科室ID格式错误', data: null });
            const nameInput = (req.body.dept_name || req.body.deptName || '').trim();
            if (!nameInput) return res.status(400).json({ code: 400, message: '科室名称不能为空', data: null });
            const dept = await Department.findByPk(deptId);
            if (!dept) return res.status(404).json({ code: 404, message: '科室不存在', data: null });
            const dup = await Department.findOne({ where: { deptName: nameInput, deptId: { [Op.ne]: deptId } } });
            if (dup) return res.status(409).json({ code: 409, message: '科室名称已存在', data: null });
            await dept.update({ deptName: nameInput });
            return res.status(200).json({ code: 200, message: '更新成功', data: { dept_id: dept.deptId, dept_name: dept.deptName } });
        } catch (error) {
            return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
        }
    },
    deleteDepartment: async (req, res) => {
        try {
            // 参数空值检测
            if (!req.params || !req.params.deptId) {
                return res.status(400).json({ code: 400, message: '缺少必要参数：deptId', data: null });
            }
            
            const deptId = parseInt(req.params.deptId, 10);
            if (isNaN(deptId)) return res.status(400).json({ code: 400, message: '科室ID格式错误', data: null });
            const dept = await Department.findByPk(deptId);
            if (!dept) return res.status(404).json({ code: 404, message: '科室不存在', data: null });
            const doctorCount = await Doctor.count({ where: { deptId } });
            if (doctorCount > 0) return res.status(409).json({ code: 409, message: '该科室下存在医生，无法删除', data: { doctorCount } });
            await Department.destroy({ where: { deptId } });
            return res.status(200).json({ code: 200, message: '删除成功', data: { dept_id: deptId } });
        } catch (error) {
            return res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
        }
    },
    setUserAccountStatus: setUserAccountStatus
};
