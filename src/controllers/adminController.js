// controllers/adminController.js

const { Appointment, Schedule, Doctor, Department, User, CallLog } = require('../models');
const { Op } = require('sequelize');


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

module.exports = {
    getPendingSchedules: exports.getPendingSchedules,
    auditSchedule: exports.auditSchedule,
    deleteScheduleByAdmin: exports.deleteScheduleByAdmin,
    getLeaveRequests: exports.getLeaveRequests,
    approveLeaveRequest: exports.approveLeaveRequest,
    rejectLeaveRequest: exports.rejectLeaveRequest
};