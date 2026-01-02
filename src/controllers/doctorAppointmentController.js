const { Appointment, Schedule, Doctor, Department, User, CallLog } = require('../models');
const { Op } = require('sequelize');
// 定义排班最大人数的默认下限值
const MIN_MAX_COUNT = 10;
const MAX_MAX_COUNT = 50; // 最大预约数上限
const MAX_WAITING_LIST_LIMIT = 20; // 最大候诊队列名额上限

// 获取状态描述的辅助函数
function getStatusDescription(status) {
  const statusMap = {
    'pending': '待就诊',
    'called': '已叫号',
    'completed': '已完成',
    'cancelled': '已取消',
    'missed': '已过号'
  };
  return statusMap[status] || '未知状态';
}

// 获取排班队列状态的辅助函数
async function getScheduleStatus(scheduleId) {
  try {
    const appointments = await Appointment.findAll({
      where: {
        scheduleId,
        isValid: 1,
        status: { [Op.in]: ['pending', 'called'] }
      },
      order: [['apptId', 'ASC']]
    });
    
    const pendingCount = appointments.filter(appt => appt.status === 'pending').length;
    const calledCount = appointments.filter(appt => appt.status === 'called').length;
    const currentCalled = appointments.find(appt => appt.status === 'called');
    
    return {
      scheduleId,
      totalWaiting: appointments.length,
      pendingCount,
      calledCount,
      currentCalled: currentCalled ? {
        apptId: currentCalled.apptId,
        waitingNumber: appointments.findIndex(appt => appt.apptId === currentCalled.apptId) + 1
      } : null
    };
  } catch (error) {
    
    return null;
  }
}

// 医生端：标记接诊完成
exports.markAppointmentCompletedByDoctor = async (req, res) => {
  try {
    // 参数空值检测
    const { apptId } = req.params;
    if (!apptId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：apptId',
        data: null
      });
    }
    
    // 用户信息空值检测
    const userInfo = req.user;
    if (!userInfo) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const { userId, role } = userInfo;
    if (!userId || !role) {
      return res.status(401).json({
        code: 401,
        message: '用户信息不完整',
        data: null
      });
    }

    // 同时支持从query和body中获取参数，提高兼容性
    const { scheduleId, date, timeSlot, status } = { ...(req.query || {}), ...(req.body || {}) };
    
    // 角色校验
    if (role !== 'doctor') {
      return res.status(403).json({
        code: 403,
        message: '无权限：仅医生可进行接诊完成操作',
        data: null
      });
    }

    const doctor = await Doctor.findOne({ where: { userId: userId } });
    if (!doctor) {
      return res.status(403).json({
        code: 403,
        message: '医生信息不存在或未绑定账号',
        data: null
      });
    }

    const transaction = await Appointment.sequelize.transaction();
    try {
      const appointment = await Appointment.findOne({
        where: { apptId: apptId, isValid: 1 },
        include: [{ model: Schedule }],
        transaction
      });

      if (!appointment) {
        await transaction.rollback();
        return res.status(404).json({
          code: 404,
          message: '未找到有效的预约记录',
          data: null
        });
      }

      if (!appointment.Schedule || appointment.Schedule.doctorId !== doctor.doctorId) {
        await transaction.rollback();
        return res.status(403).json({
          code: 403,
          message: '无权限：只能操作自己排班下的预约',
          data: null
        });
      }

      // 业务规则：只有已叫号状态的预约可以标记为完成
      if (appointment.status !== 'called') {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '当前预约状态不允许接诊完成（需为已叫号状态）',
          data: { status: appointment.status, statusDescription: getStatusDescription(appointment.status) }
        });
      }

      // 记录原始状态
      const originalStatus = appointment.status;

      // 更新预约状态为已完成
      await appointment.update({ status: 'completed' }, { transaction });

      // 记录完成日志（使用数据库自增ID）
      await CallLog.create({
        apptId: appointment.apptId,
        doctorId: doctor.doctorId,
        operation: 'completed',
        operationTime: new Date()
      }, { 
        transaction
      });

      await transaction.commit();

      // 获取更新后的排班状态信息
      const updatedScheduleStatus = await getScheduleStatus(appointment.Schedule.scheduleId);

      return res.status(200).json({
        code: 200,
        message: '已标记接诊完成',
        data: {
          appointmentId: appointment.apptId,
          status: 'completed',
          statusDescription: getStatusDescription('completed'),
          // 添加更新后的排班状态信息
          scheduleStatus: updatedScheduleStatus
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    
    return res.status(500).json({
      code: 500,
      message: '接诊完成处理过程中发生错误',
      data: null
    });
  }
};

// 医生端：叫号
exports.callAppointmentByDoctor = async (req, res) => {
  try {
    // 参数空值检测
    const { apptId } = req.params;
    if (!apptId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：apptId',
        data: null
      });
    }
    
    // 用户信息空值检测
    const userInfo = req.user;
    if (!userInfo) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const { userId, role } = userInfo;
    if (!userId || !role) {
      return res.status(401).json({
        code: 401,
        message: '用户信息不完整',
        data: null
      });
    }

    // 角色校验：仅医生可操作
    if (role !== 'doctor') {
      return res.status(403).json({
        code: 403,
        message: '无权限：仅医生可进行叫号操作',
        data: null
      });
    }

    // 查找医生实体
    const doctor = await Doctor.findOne({ where: { userId: userId } });
    if (!doctor) {
      return res.status(403).json({
        code: 403,
        message: '医生信息不存在或未绑定账号',
        data: null
      });
    }

    const transaction = await Appointment.sequelize.transaction();
    try {
      // 查找预约并携带排班（校验归属）
      const appointment = await Appointment.findOne({
        where: { apptId, isValid: 1 },
        include: [{ model: Schedule }],
        transaction
      });

      if (!appointment) {
        await transaction.rollback();
        return res.status(404).json({
          code: 404,
          message: '未找到有效的预约记录',
          data: null
        });
      }

      // 校验预约是否属于当前医生的排班
      if (!appointment.Schedule || appointment.Schedule.doctorId !== doctor.doctorId) {
        await transaction.rollback();
        return res.status(403).json({
          code: 403,
          message: '无权限：只能操作自己排班下的预约',
          data: null
        });
      }

      // 状态校验：仅待就诊可叫号
      if (appointment.status !== 'pending') {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '当前预约状态不允许叫号',
          data: { status: appointment.status, statusDescription: getStatusDescription(appointment.status) }
        });
      }
      
      // 如果有其他已被呼叫但未完成的预约，先将其标记为过号
      const activeCalledAppointment = await Appointment.findOne({
        where: {
          scheduleId: appointment.scheduleId,
          status: 'called',
          isValid: 1
        },
        transaction
      });
      
      if (activeCalledAppointment) {
        await activeCalledAppointment.update({ status: 'missed' }, { transaction });
        
        // 记录过号日志（使用数据库自增ID）
      await CallLog.create({
        apptId: activeCalledAppointment.apptId,
        doctorId: doctor.doctorId,
        operation: 'missed',
        operationTime: new Date()
      }, { 
        transaction
      });
      }
      
      // 更新状态为已叫号
      await appointment.update({ status: 'called' }, { transaction });

      // 记录叫号日志（使用数据库自增ID）
      await CallLog.create({
        apptId: appointment.apptId,
        doctorId: doctor.doctorId,
        operation: 'called',
        operationTime: new Date()
      }, { 
        transaction
      });

      await transaction.commit();
      
      // 获取更新后的排班状态
      const updatedScheduleStatus = await getScheduleStatus(appointment.scheduleId);

      return res.status(200).json({
        code: 200,
        message: '叫号成功',
        data: {
          appointmentId: appointment.apptId,
          status: 'called',
          statusDescription: getStatusDescription('called'),
          // 添加更新后的排班状态信息
          scheduleStatus: updatedScheduleStatus
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    
    return res.status(500).json({
      code: 500,
      message: '叫号过程中发生错误',
      data: null
    });
  }
};

// 医生端：标记过号
exports.markAppointmentMissedByDoctor = async (req, res) => {
  try {
    // 参数空值检测
    const { apptId } = req.params;
    if (!apptId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：apptId',
        data: null
      });
    }
    
    // 用户信息空值检测
    const userInfo = req.user;
    if (!userInfo) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const { userId, role } = userInfo;
    if (!userId || !role) {
      return res.status(401).json({
        code: 401,
        message: '用户信息不完整',
        data: null
      });
    }

    if (role !== 'doctor') {
      return res.status(403).json({
        code: 403,
        message: '无权限：仅医生可进行过号操作',
        data: null
      });
    }

    const doctor = await Doctor.findOne({ where: { userId } });
    if (!doctor) {
      return res.status(403).json({
        code: 403,
        message: '医生信息不存在或未绑定账号',
        data: null
      });
    }

    const transaction = await Appointment.sequelize.transaction();
    try {
      const appointment = await Appointment.findOne({
        where: { apptId, isValid: 1 },
        include: [{ model: Schedule }],
        transaction
      });

      if (!appointment) {
        await transaction.rollback();
        return res.status(404).json({
          code: 404,
          message: '未找到有效的预约记录',
          data: null
        });
      }

      if (!appointment.Schedule || appointment.Schedule.doctorId !== doctor.doctorId) {
        await transaction.rollback();
        return res.status(403).json({
          code: 403,
          message: '无权限：只能操作自己排班下的预约',
          data: null
        });
      }

      // 业务规则：支持对pending和called状态的预约进行过号处理
      if (appointment.status !== 'called' && appointment.status !== 'pending') {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '当前预约状态不允许过号（需为待叫号或已叫号状态）',
          data: { status: appointment.status, statusDescription: getStatusDescription(appointment.status) }
        });
      }

      // 记录原始状态
      const originalStatus = appointment.status;

      await appointment.update({ status: 'missed' }, { transaction });

      // 记录过号日志（使用数据库自增ID）
      await CallLog.create({
        apptId: appointment.apptId,
        doctorId: doctor.doctorId,
        operation: 'missed',
        operationTime: new Date()
      }, { 
        transaction
      });

      await transaction.commit();

      // 获取更新后的排班状态
      const updatedScheduleStatus = await getScheduleStatus(appointment.scheduleId);

      return res.status(200).json({
        code: 200,
        message: '已标记过号',
        data: {
          appointmentId: appointment.apptId,
          status: 'missed',
          statusDescription: getStatusDescription('missed'),
          // 添加更新后的排班状态信息
          scheduleStatus: updatedScheduleStatus
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    
    return res.status(500).json({
      code: 500,
      message: '过号处理过程中发生错误',
      data: null
    });
  }
};

// 获取医生当天排班信息和叫号状态
exports.getDoctorScheduleStatus = async (req, res) => {
  try {
    // 确保req.query存在
    if (!req.query) {
      return res.status(400).json({
        code: 400,
        message: '请求参数异常，请检查请求格式',
        data: null
      });
    }
    
    const { doctorId, date } = req.query;
    
    // 基本验证
    if (!doctorId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：doctorId',
        data: null
      });
    }
    
    // 如果没有提供日期，使用当天日期
    const queryDate = date || new Date().toISOString().split('T')[0];
    
    // 查找医生当天的所有排班
    const schedules = await Schedule.findAll({
      where: {
        doctorId: doctorId,
        scheduleDate: queryDate,
        auditStatus: 'approved'
      },
      include: [
        {
          model: Doctor,
          include: [
            { model: Department },
            { model: User, attributes: ['username'] }
          ]
        }
      ],
      // 第513行 - 修复time_slot
      order: [['timeSlot', 'ASC']]
    });
    
    if (schedules.length === 0) {
      return res.status(404).json({
        code: 404,
        message: `未找到医生ID ${doctorId} 在 ${queryDate} 的排班信息`,
        data: null
      });
    }
    
    // 提取所有scheduleId
    const scheduleIds = schedules.map(schedule => schedule.scheduleId);

    // 批量查询所有相关的预约记录（一次查询替代多次查询）
    const allAppointments = await Appointment.findAll({
      where: {
        scheduleId: { [Op.in]: scheduleIds },
        isValid: 1
      },
      order: [['serialNumber', 'ASC']]
    });

    // 批量查询最近的叫号日志（一次查询替代多次查询）
    const recentCallLog = await CallLog.findOne({
      where: {
        doctorId: doctorId
      },
      order: [['operation_time', 'DESC']],
      limit: 1
    });
    
    // 在内存中进行数据聚合和处理
    const schedulesWithStatus = schedules.map((schedule) => {
      // 筛选出当前排班的预约记录
      const scheduleAppointments = allAppointments.filter(
        appt => appt.scheduleId === schedule.scheduleId
      );
      
      // 计算各种状态的预约数量
      const calledCount = scheduleAppointments.filter(appt => appt.status === 'called').length;
      const completedCount = scheduleAppointments.filter(appt => appt.status === 'completed').length;
      const missedCount = scheduleAppointments.filter(appt => appt.status === 'missed').length;
      const pendingCount = scheduleAppointments.filter(appt => appt.status === 'pending').length;
      const cancelledCount = scheduleAppointments.filter(appt => appt.status === 'cancelled').length;
      
      // 找出当前应该叫的序号（即第一个pending状态的预约）
      const currentPending = scheduleAppointments.filter(appt => appt.status === 'pending').sort((a, b) => a.serialNumber - b.serialNumber)[0];
      const currentQueuePosition = currentPending ? currentPending.serialNumber : null;
      // 获取最后叫号的serial_number
      const lastCalled = scheduleAppointments.filter(appt => appt.status === 'called' || appt.status === 'completed').sort((a, b) => b.serialNumber - a.serialNumber)[0];
      const lastCalledNumber = lastCalled ? lastCalled.serialNumber : 0;
      
      // 获取当前正在被呼叫的预约（called状态）
      const currentlyCalled = scheduleAppointments.find(appt => appt.status === 'called');
      
      return {
        // 排班基本信息
        schedule: {
          scheduleId: schedule.scheduleId,
          scheduleDate: schedule.scheduleDate,
          timeSlot: schedule.timeSlot,
          doctorId: schedule.Doctor.doctorId,
          doctorName: schedule.Doctor.User.username,
          doctorTitle: schedule.Doctor.title,
          departmentName: schedule.Doctor.Department ? schedule.Doctor.Department.deptName : null,
          maxCount: schedule.maxCount,
          availableCount: schedule.availableCount,
          auditStatus: schedule.auditStatus
        },
        counts,
        queue,
        total: queue.length
      }
    });
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        date: queryDate,
        doctorId: doctorId,
        schedules: schedulesWithStatus,
        total_schedules: schedulesWithStatus.length,
        // 添加整体统计信息
        summary: {
          totalAvailableCount: schedules.reduce((sum, s) => sum + s.availableCount, 0),
          total_appointments_count: schedulesWithStatus.reduce((sum, s) => sum + s.total_appointments, 0),
          total_completed_count: schedulesWithStatus.reduce((sum, s) => sum + s.completed_count, 0)
        }
      }
    });
    
  } catch (error) {
    
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};

// 辅助函数：获取单个排班的状态信息
async function getScheduleStatus(scheduleId) {
  try {
    // 获取排班信息
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) {
      return null;
    }
    
    // 获取该排班下的所有有效预约
    const appointments = await Appointment.findAll({
      where: {
        scheduleId: schedule.scheduleId,
        isValid: 1
      },
      order: [['serialNumber', 'ASC']]
    });
    
    // 计算各种状态的预约数量
    const calledCount = appointments.filter(appt => appt.status === 'called').length;
    const completedCount = appointments.filter(appt => appt.status === 'completed').length;
    const missedCount = appointments.filter(appt => appt.status === 'missed').length;
    const pendingCount = appointments.filter(appt => appt.status === 'pending').length;
    
    // 找出当前应该叫的序号
    const currentPending = appointments.find(appt => appt.status === 'pending');
    const currentQueuePosition = currentPending ? currentPending.serialNumber : null;
    
    // 找出最后一个已叫号的预约
    const lastCalled = appointments.filter(appt => 
      appt.status === 'called' || appt.status === 'completed' || appt.status === 'missed'
    ).sort((a, b) => b.serialNumber - a.serialNumber)[0];
    const lastCalledNumber = lastCalled ? lastCalled.serialNumber : 0;
    
    // 获取当前正在被呼叫的预约
    const currentlyCalled = appointments.find(appt => appt.status === 'called');
    
    return {
      scheduleId: schedule.scheduleId,
      availableCount: schedule.availableCount,
      remainingCount: schedule.maxCount - appointments.length,
      calledCount: calledCount,
      completedCount: completedCount,
      missedCount: missedCount,
      pendingCount: pendingCount,
      currentQueuePosition: currentQueuePosition,
      lastCalledNumber: lastCalledNumber,
      nextToCall: currentQueuePosition || (lastCalledNumber + 1),
      currentlyCalledAppointment: currentlyCalled ? {
        appointmentId: currentlyCalled.apptId,
        serialNumber: currentlyCalled.serialNumber
      } : null
    };
  } catch (error) {
    
    return null;
  }
}

// 获取状态描述的辅助函数
function getStatusDescription(status) {
  const statusMap = {
    'pending': '待就诊',
    'called': '已叫号',
    'completed': '已完成',
    'cancelled': '已取消',
    'missed': '已过号'
  };
  return statusMap[status] || '未知状态';
}

// 医生端队列查询（按排班查看当前队列）
exports.getDoctorQueue = async (req, res) => {
  try {
    const { scheduleId, date, timeSlot, status } = { ...(req.query || {}), ...(req.body || {}) };
    const userInfo = req.user;
    if (!userInfo) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }

    const { userId, role } = userInfo;
    if (!userId || !role) {
      return res.status(401).json({
        code: 401,
        message: '用户信息不完整',
        data: null
      });
    }

    if (role !== 'doctor') {
      return res.status(403).json({
        code: 403,
        message: '仅医生可查询本人的就诊队列',
        data: null
      });
    }

    const doctor = await Doctor.findOne({ where: { userId: userId } });
    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '未找到医生信息',
        data: null
      });
    }

    let scheduleWhere = { doctorId: doctor.doctorId };
    if (scheduleId) {
      scheduleWhere.scheduleId = scheduleId;
    } else if (date && timeSlot) {
      scheduleWhere.scheduleDate = date;
      scheduleWhere.timeSlot = timeSlot;
      scheduleWhere.auditStatus = 'approved';
    } else {
      return res.status(400).json({
        code: 400,
        message: '请提供 scheduleId 或 (date + timeSlot)',
        data: null
      });
    }

    const schedule = await Schedule.findOne({
      where: scheduleWhere,
      include: [
        {
          model: Doctor,
          include: [
            { model: Department },
            { model: User, attributes: ['username'] }
          ]
        }
      ]
    });

    if (!schedule) {
      return res.status(404).json({
        code: 404,
        message: '未找到匹配的排班',
        data: null
      });
    }

    let statusFilter;
    if (status) {
      const list = Array.isArray(status) ? status : String(status).split(',');
      statusFilter = { [Op.in]: list };
    } else {
      statusFilter = { [Op.in]: ['pending', 'called'] };
    }

    const appointments = await Appointment.findAll({
      where: {
        scheduleId: schedule.scheduleId,
        isValid: 1,
        status: statusFilter
      },
      include: [
        { model: User, attributes: ['user_id', 'username'], required: true }
      ],
      order: [['serialNumber', 'ASC']]
    });

    const counts = {
      pending: appointments.filter(a => a.status === 'pending').length,
      called: appointments.filter(a => a.status === 'called').length,
      missed: appointments.filter(a => a.status === 'missed').length,
      completed: appointments.filter(a => a.status === 'completed').length
    };

    const queue = appointments.map(a => ({
      appointmentId: a.appt_id,
      patientId: a.User.user_id,
      patientName: a.User.username,
      serialNumber: a.serialNumber,
      status: a.status,
      statusDescription: getStatusDescription(a.status),
      appointmentTime: a.appointmentTime
    }));

    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        schedule: {
          scheduleId: schedule.scheduleId,
          scheduleDate: schedule.scheduleDate,
          timeSlot: schedule.timeSlot,
          doctorId: schedule.Doctor.doctorId,
          doctorName: schedule.Doctor.User.username,
          doctorTitle: schedule.Doctor.title,
          departmentName: schedule.Doctor.Department ? schedule.Doctor.Department.deptName : null,
          maxCount: schedule.maxCount,
          availableCount: schedule.availableCount,
          auditStatus: schedule.auditStatus
        },
        counts,
        queue,
        total: queue.length
      }
    });
  } catch (error) {
    
    return res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
}

// 辅助函数：根据用户ID查找医生ID
async function getDoctorId(userId) {
  const doctor = await Doctor.findOne({ where: { userId: userId } });
  return doctor ? doctor.doctorId : null;
}

// 1. 查询有排班的日期
exports.getScheduledDates = async (req, res) => {
  try {
    // 确保req.query存在
    if (!req.query) {
      return res.status(400).json({ code: 400, message: '请求参数异常，请检查请求格式' });
    }
    
    // 确保正确获取doctorId查询参数
    const startMonth = req.query.startMonth;
    const endMonth = req.query.endMonth;
    const doctorId = req.query.doctorId;
    
    // 验证参数
    if (!startMonth) {
      return res.status(400).json({ code: 400, message: '缺少起始月份参数' });
    }
    
    // 确定日期范围
    // 确保月份格式正确，转换为标准的 YYYY-MM-DD 格式
    const [year, month] = startMonth.split('-');
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    
    // 确定结束日期：如果未提供 endMonth，则默认为 startMonth 的最后一天
    let endDate;
    if (endMonth) {
        const [endYear, endMonthNum] = endMonth.split('-');
        endDate = new Date(parseInt(endYear), parseInt(endMonthNum) - 1, 1);
        endDate.setMonth(endDate.getMonth() + 1, 0); // 设置到下个月第一天，再减去1天
    } else {
        endDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        endDate.setMonth(endDate.getMonth() + 1, 0);
    }
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // 如果提供了doctorId参数，直接使用
    if (doctorId) {
      // 使用查询参数中的医生ID
      const schedules = await Schedule.findAll({
        attributes: ['scheduleDate'],
        where: {
          doctorId: doctorId,
          scheduleDate: {
            [Op.between]: [startDate, endDateStr]
          }
        },
        group: ['scheduleDate'],
        raw: true
      });
      
      // 确保正确处理日期格式，无论数据库返回的是什么类型
      const dates = schedules.map(s => {
        const date = s.scheduleDate;
        if (date instanceof Date) {
          return date.toISOString().split('T')[0];
        } else if (typeof date === 'string') {
          return date.split('T')[0]; // 假设格式为 'YYYY-MM-DDTHH:mm:ss'
        }
        return date; // 如果是其他格式，直接返回
      });
      return res.status(200).json({ code: 200, message: '查询有排班日期成功', data: dates });
    }
    
    // 否则需要认证用户
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ code: 401, message: '请先登录' });
    }
    
    // 从认证用户获取医生ID
    let userDoctorId = await getDoctorId(req.user.userId);
    
    // 如果用户未关联医生信息，但提供了doctorId参数，则使用参数中的doctorId
    if (!userDoctorId && doctorId) {
      userDoctorId = doctorId;
    } else if (!userDoctorId) {
      return res.status(403).json({ code: 403, message: '当前用户未关联医生信息，请提供doctorId参数' });
    }
    
    // 使用认证用户的医生ID查询排班
    const schedules = await Schedule.findAll({
      attributes: ['scheduleDate'],
      where: {
        doctorId: userDoctorId,
        scheduleDate: {
          [Op.between]: [startDate, endDateStr]
        }
      },
      group: ['scheduleDate'],
      raw: true
    });
    
    // 确保正确处理日期格式，无论数据库返回的是什么类型
    const dates = schedules.map(s => {
      const date = s.scheduleDate;
      if (date instanceof Date) {
        return date.toISOString().split('T')[0];
      } else if (typeof date === 'string') {
        return date.split('T')[0]; // 假设格式为 'YYYY-MM-DDTHH:mm:ss'
      }
      return date; // 如果是其他格式，直接返回
    });
    return res.status(200).json({ code: 200, message: '查询有排班日期成功', data: dates });
  } catch (error) {
    
    return res.status(500).json({ code: 500, message: '服务器错误' });
  }
};

// 2. 查询指定日期的排班详情
exports.getScheduleDetailsByDate = async (req, res) => {
  try {
    // 确保req.query存在
    if (!req.query) {
      return res.status(400).json({ code: 400, message: '请求参数异常，请检查请求格式' });
    }
    
    const { date, doctorId } = req.query; // 格式: YYYY-MM-DD
    let userDoctorId;
    
    // 验证日期参数
    if (!date) {
      return res.status(400).json({ code: 400, message: '缺少日期参数' });
    }
    
    // 如果提供了doctorId参数，直接使用
    if (doctorId) {
      userDoctorId = doctorId;
    } else {
      // 否则从认证用户获取医生ID
      const { userId } = req.user;
      userDoctorId = await getDoctorId(userId);
      
      if (!userDoctorId) {
        return res.status(403).json({ code: 403, message: '当前用户未关联医生信息，请提供doctorId参数' });
      }
    }

    const schedules = await Schedule.findAll({
      where: {
        doctorId: userDoctorId,
        scheduleDate: date
      },
      order: [['timeSlot', 'ASC']]
    });

    const formattedDetails = await Promise.all(schedules.map(async (schedule) => {
        // 统计当前排班下已预约人数
        const pendingAppointments = await Appointment.count({
            where: {
                scheduleId: schedule.scheduleId,
                isValid: 1,
                status: { [Op.in]: ['pending', 'called'] }
            }
        });

        // 假设 Schedule 模型中新增一个 status 字段: 'Active' / 'Cancelled'
        const status = schedule.availableCount === 0 && pendingAppointments === 0 ? 'Cancelled' : 'Active';

        return {
            scheduleId: schedule.scheduleId,
            timeSlot: schedule.timeSlot,
            maxCount: schedule.maxCount,
            availableCount: schedule.availableCount,
            status: status,
            auditStatus: schedule.auditStatus,
            pendingAppointments: pendingAppointments
        };
    }));

    return res.status(200).json({ code: 200, message: '查询排班详情成功', data: formattedDetails });
  } catch (error) {
    
    return res.status(500).json({ code: 500, message: '服务器错误' });
  }
};

// 医生端：发起请假请求 (修改现有逻辑)
exports.requestLeaveForSchedule = async (req, res) => {
    try {
        // 参数空值检测
        const { scheduleId } = req.params;
        if (!scheduleId) {
            return res.status(400).json({ code: 400, message: '缺少必要参数：scheduleId' });
        }
        
        // 用户信息空值检测
        const userInfo = req.user;
        if (!userInfo) {
            return res.status(401).json({ code: 401, message: '用户未登录或登录状态已过期' });
        }
        
        const { userId, role } = userInfo;
        if (!userId || !role) {
            return res.status(401).json({ code: 401, message: '用户信息不完整' });
        }
        
        // 请假原因（可选，但提供更好的用户体验）
        const { reason } = req.body || {};
        
        // 1. 角色与ID校验
        if (role !== 'doctor') {
        return res.status(403).json({ code: 403, message: '无权限：仅医生可操作' });
    }
    const doctor = await Doctor.findOne({ where: { userId: userId } });
    if (!doctor) {
        return res.status(403).json({ code: 403, message: '医生信息不存在或无权操作' });
    }
    const doctorId = doctor.doctor_id; 
    
    const parsedScheduleId = parseInt(scheduleId, 10);
    
    const transaction = await Schedule.sequelize.transaction();
    try {
        // 2. 查找排班并校验权限和状态
        const schedule = await Schedule.findOne({ 
            where: { 
                schedule_id: parsedScheduleId,
                doctor_id: doctorId, // 校验权限
                audit_status: 'approved' // 只能对已批准的排班请假
            },
            transaction 
        });

        if (!schedule) {
            await transaction.rollback();
            return res.status(404).json({ code: 404, message: '未找到已批准的排班记录或无权限操作' });
        }
        
        // 3. 更新状态为 'leave_requested'
        await schedule.update({
            // 使用 auditStatus 来记录请假状态
            auditStatus: 'leave_requested',
            // 可选：如果您的Schedule模型有字段，可以记录请假原因
            // leave_reason: reason 
        }, { transaction });

        await transaction.commit();

        return res.status(200).json({
            code: 200,
            message: '排班请假申请已提交，等待管理员审核。',
            data: { 
                scheduleId: parsedScheduleId, 
                auditStatus: 'leave_requested',
                reason: reason
            }
        });

        } catch (error) {
            await transaction.rollback();
            
            return res.status(500).json({ code: 500, message: '服务器内部错误' });
        }
    } catch (error) {
        console.error('requestLeaveForSchedule 接口执行错误:', error);
        return res.status(500).json({ code: 500, message: '服务器内部错误' });
    }
};

// 医生端：更新排班候补开关设置
exports.updateScheduleAllowWaiting = async (req, res) => {
  try {
    // 参数空值检测
    const { scheduleId } = req.params;
    if (!scheduleId) {
      return res.status(400).json({ code: 400, message: '缺少必要参数：scheduleId' });
    }
    
    // 确保req.body存在
    if (!req.body) {
      return res.status(400).json({ code: 400, message: '请求体不能为空' });
    }
    
    const { allowWaiting } = req.body;
    
    // 用户信息空值检测
    const userInfo = req.user;
    if (!userInfo) {
      return res.status(401).json({ code: 401, message: '用户未登录或登录状态已过期' });
    }
    
    const { userId, role } = userInfo;
    if (!userId || !role) {
      return res.status(401).json({ code: 401, message: '用户信息不完整' });
    }

    const transaction = await Schedule.sequelize.transaction();
    try {
      // 1. 角色校验
      if (role !== 'doctor') {
        await transaction.rollback();
        return res.status(403).json({ code: 403, message: '无权限：仅医生可操作排班' });
      }

      // 2. 获取 doctorId 
      const doctor = await Doctor.findOne({ where: { userId: userId } });
      if (!doctor) {
        await transaction.rollback();
        return res.status(403).json({ code: 403, message: '医生信息不存在或未绑定账号' });
      }
      const doctorId = doctor.doctorId;

      // 3. 查找排班并校验权限
      const schedule = await Schedule.findOne({ 
        where: { 
          scheduleId: scheduleId,
          doctorId: doctorId // 确保只能操作自己的排班
        },
        transaction 
      });

      if (!schedule) {
        await transaction.rollback();
        return res.status(404).json({ code: 404, message: '未找到排班记录或无权限操作' });
      }

      // 4. 更新排班的候补开关设置
      await schedule.update({ allowWaiting }, { transaction });

      await transaction.commit();

      return res.status(200).json({
        code: 200,
        message: '排班候补设置已更新',
        data: { 
          scheduleId: schedule.scheduleId,
          scheduleDate: schedule.scheduleDate,
          timeSlot: schedule.timeSlot,
          allowWaiting: schedule.allowWaiting,
          maxCount: schedule.maxCount,
          availableCount: schedule.availableCount
        }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    
    return res.status(500).json({ code: 500, message: '更新排班候补设置失败' });
  }
};

// 医生端：更新排班候补名额限制
exports.updateScheduleWaitingLimit = async (req, res) => {
  try {
    // 参数空值检测
    const { scheduleId } = req.params;
    if (!scheduleId) {
      return res.status(400).json({ code: 400, message: '缺少必要参数：scheduleId' });
    }
    
    // 确保req.body存在
    if (!req.body) {
      return res.status(400).json({ code: 400, message: '请求体不能为空' });
    }
    
    const { waitingListLimit } = req.body;
    
    // 用户信息空值检测
    const userInfo = req.user;
    if (!userInfo) {
      return res.status(401).json({ code: 401, message: '用户未登录或登录状态已过期' });
    }
    
    const { userId, role } = userInfo;
    if (!userId || !role) {
      return res.status(401).json({ code: 401, message: '用户信息不完整' });
    }

    const transaction = await Schedule.sequelize.transaction();
    try {
      // 1. 角色校验
      if (role !== 'doctor') {
        await transaction.rollback();
        return res.status(403).json({ code: 403, message: '无权限：仅医生可操作排班' });
      }

      // 2. 获取 doctorId 
      const doctor = await Doctor.findOne({ where: { userId: userId } });
      if (!doctor) {
        await transaction.rollback();
        return res.status(403).json({ code: 403, message: '医生信息不存在或未绑定账号' });
      }
      const doctorId = doctor.doctorId;

      // 3. 查找排班并校验权限
      const schedule = await Schedule.findOne({ 
        where: { 
          scheduleId: scheduleId,
          doctorId: doctorId // 确保只能操作自己的排班
        },
        transaction 
      });

      if (!schedule) {
        await transaction.rollback();
        return res.status(404).json({ code: 404, message: '未找到排班记录或无权限操作' });
      }

      // 4. 更新排班的候补名额限制
      // 验证候诊队列名额限制
      let finalWaitingListLimit = parseInt(waitingListLimit, 10);
      if (isNaN(finalWaitingListLimit) || finalWaitingListLimit < 0) {
          finalWaitingListLimit = 0; // 最低为0
      }
      if (finalWaitingListLimit > MAX_WAITING_LIST_LIMIT) {
          finalWaitingListLimit = MAX_WAITING_LIST_LIMIT; // 最高为20
      }
      await schedule.update({ waitingListLimit: finalWaitingListLimit }, { transaction });

      await transaction.commit();

      return res.status(200).json({
        code: 200,
        message: '排班候补名额限制已更新',
        data: { 
          scheduleId: schedule.scheduleId,
          scheduleDate: schedule.scheduleDate,
          timeSlot: schedule.timeSlot,
          allowWaiting: schedule.allowWaiting,
          waitingListLimit: schedule.waitingListLimit,
          maxCount: schedule.maxCount,
          availableCount: schedule.availableCount
        }
      });

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    
    return res.status(500).json({ code: 500, message: '更新排班候补名额限制失败' });
  }
};

// 医生端：提报排班计划 (新增 - 包含最大人数校验)
exports.proposeSchedule = async (req, res) => {
  // 用户信息空值检测
  const userInfo = req.user;
  if (!userInfo) {
    return res.status(401).json({ code: 401, message: '用户未登录或登录状态已过期' });
  }
  
  const { userId, role } = userInfo;
  if (!userId || !role) {
    return res.status(401).json({ code: 401, message: '用户信息不完整' });
  }
  
  // 角色校验
  if (role !== 'doctor') {
    return res.status(403).json({ code: 403, message: '无权限：仅医生可提报排班' });
  }
  
  // 确保req.body存在
  if (!req.body) {
    return res.status(400).json({ code: 400, message: '请求体不能为空' });
  }
  
  // maxCount 可能是 null 或未定义，需要处理
  const { scheduleDate, timeSlot, maxCount: inputMaxCount } = req.body; 

  // 获取 doctorId 
  const doctor = await Doctor.findOne({ where: { userId: userId } });
  if (!doctor) {
    return res.status(403).json({ code: 403, message: '医生信息不存在或未绑定账号' });
  }
  const doctorId = doctor.doctorId; 

  // 参数验证与最大人数默认值设置
  if (!scheduleDate) {
    return res.status(400).json({ code: 400, message: '排班日期不能为空' });
  }
  if (!timeSlot) {
    return res.status(400).json({ code: 400, message: '时段不能为空' });
  }
  
  let finalMaxCount = parseInt(inputMaxCount, 10);
  
  // 如果 inputMaxCount 无效 (NaN, null, 0 等)，或者小于最小值，则使用默认最小值
  if (isNaN(finalMaxCount) || finalMaxCount < MIN_MAX_COUNT) {
      finalMaxCount = MIN_MAX_COUNT;
  }
  // 如果 inputMaxCount 大于最大值，则使用最大值
  if (finalMaxCount > MAX_MAX_COUNT) {
      finalMaxCount = MAX_MAX_COUNT;
  }

  try {
    // 检查是否重复提报
    const existingSchedule = await Schedule.findOne({
      where: {
        doctorId: doctorId,
        scheduleDate: scheduleDate,
        timeSlot: timeSlot
      }
    });

    if (existingSchedule) {
      // 检查当前状态是否为 pending/approved/rejected，如果已存在，则禁止重复提报
      return res.status(400).json({ code: 400, message: '该时段排班已存在，请勿重复提报' });
    }

    // 创建排班记录， auditStatus 设为 pending
    // 不包含scheduleId字段，让Sequelize自动处理自增
    const newSchedule = await Schedule.create({
      doctorId: doctorId,
      scheduleDate: scheduleDate,
      timeSlot: timeSlot,
      maxCount: finalMaxCount,
      availableCount: finalMaxCount,
      auditStatus: 'pending'
    });

    return res.status(201).json({ 
        code: 201, 
        message: '排班提报成功，等待管理员审核', 
        data: { 
            scheduleId: newSchedule.scheduleId, 
            maxCount: finalMaxCount,
            auditStatus: 'pending' 
        } 
    });

  } catch (error) {
    
    return res.status(500).json({ code: 500, message: '提报排班计划失败' });
  }
};