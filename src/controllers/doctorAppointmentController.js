const { Appointment, Schedule, Doctor, Department, User, CallLog } = require('../models');
const { Op } = require('sequelize');

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
        is_valid: 1,
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
    console.error('获取排班状态失败:', error);
    return null;
  }
}

// 医生端：标记接诊完成
exports.markAppointmentCompletedByDoctor = async (req, res) => {
  try {
    const { apptId } = req.params;
    const { userId, role } = req.user;

    // 角色校验
    if (role !== 'doctor') {
      return res.status(403).json({
        code: 403,
        message: '无权限：仅医生可进行接诊完成操作',
        data: null
      });
    }

    const doctor = await Doctor.findOne({ where: { user_id: userId } });
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
        where: { appt_id: apptId, is_valid: 1 },
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

      if (!appointment.Schedule || appointment.Schedule.doctor_id !== doctor.doctor_id) {
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
        transaction,
        fields: ['apptId', 'doctorId', 'operation', 'operationTime'] // 明确指定要插入的字段，排除log_id
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
    console.error('医生标记接诊完成失败:', error);
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
    const { apptId } = req.params;
    const { userId, role } = req.user;

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
        transaction,
        fields: ['apptId', 'doctorId', 'operation', 'operationTime'] // 明确指定要插入的字段，排除log_id
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
        transaction,
        fields: ['apptId', 'doctorId', 'operation', 'operationTime'] // 明确指定要插入的字段，排除log_id
      });

      await transaction.commit();
      
      // 获取更新后的排班状态信息
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
    console.error('医生叫号失败:', error);
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
    const { apptId } = req.params;
    const { userId, role } = req.user;

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
        transaction,
        fields: ['apptId', 'doctorId', 'operation', 'operationTime'] // 明确指定要插入的字段，排除log_id
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
    console.error('医生标记过号失败:', error);
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
        doctor_id: doctorId,
        schedule_date: queryDate,
        audit_status: 'approved'
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
      order: [['time_slot', 'ASC']]
    });
    
    if (schedules.length === 0) {
      return res.status(404).json({
        code: 404,
        message: `未找到医生ID ${doctorId} 在 ${queryDate} 的排班信息`,
        data: null
      });
    }
    
    // 提取所有schedule_id
    const scheduleIds = schedules.map(schedule => schedule.schedule_id);
    
    // 批量查询所有相关的预约记录（一次查询替代多次查询）
    const allAppointments = await Appointment.findAll({
      where: {
        schedule_id: { [Op.in]: scheduleIds },
        is_valid: 1
      },
      order: [['serial_number', 'ASC']]
    });
    
    // 批量查询最近的叫号日志（一次查询替代多次查询）
    const recentCallLog = await CallLog.findOne({
      where: {
        doctor_id: doctorId
      },
      order: [['operation_time', 'DESC']],
      limit: 1
    });
    
    // 在内存中进行数据聚合和处理
    const schedulesWithStatus = schedules.map((schedule) => {
      // 筛选出当前排班的预约记录
      const scheduleAppointments = allAppointments.filter(
        appt => appt.schedule_id === schedule.schedule_id
      );
      
      // 计算各种状态的预约数量
      const calledCount = scheduleAppointments.filter(appt => appt.status === 'called').length;
      const completedCount = scheduleAppointments.filter(appt => appt.status === 'completed').length;
      const missedCount = scheduleAppointments.filter(appt => appt.status === 'missed').length;
      const pendingCount = scheduleAppointments.filter(appt => appt.status === 'pending').length;
      const cancelledCount = scheduleAppointments.filter(appt => appt.status === 'cancelled').length;
      
      // 找出当前应该叫的序号（即第一个pending状态的预约）
      const currentPending = scheduleAppointments.find(appt => appt.status === 'pending');
      const currentQueuePosition = currentPending ? currentPending.serial_number : null;
      
      // 找出最后一个已叫号的预约
      const lastCalled = scheduleAppointments.filter(appt => 
        appt.status === 'called' || appt.status === 'completed' || appt.status === 'missed'
      ).sort((a, b) => b.serial_number - a.serial_number)[0];
      const lastCalledNumber = lastCalled ? lastCalled.serial_number : 0;
      
      // 获取当前正在被呼叫的预约（called状态）
      const currentlyCalled = scheduleAppointments.find(appt => appt.status === 'called');
      
      return {
        // 排班基本信息
        schedule_id: schedule.schedule_id,
        schedule_date: schedule.schedule_date,
        time_slot: schedule.time_slot,
        max_count: schedule.max_count,
        
        // 号源库存信息
        available_count: schedule.available_count,
        total_appointments: scheduleAppointments.length,
        remaining_count: schedule.max_count - scheduleAppointments.length,
        
        // 叫号状态信息
        called_count: calledCount,
        completed_count: completedCount,
        missed_count: missedCount,
        pending_count: pendingCount,
        cancelled_count: cancelledCount,
        
        // 当前叫号顺序信息
        current_queue_position: currentQueuePosition,
        last_called_number: lastCalledNumber,
        next_to_call: currentQueuePosition || (lastCalledNumber + 1),
        currently_called_appointment: currentlyCalled ? {
          appointment_id: currentlyCalled.appt_id,
          serial_number: currentlyCalled.serial_number
        } : null,
        
        // 操作日志信息
        last_operation_time: recentCallLog ? recentCallLog.operationTime : null,
        last_operation_type: recentCallLog ? recentCallLog.operation : null,
        
        // 医生信息
        doctor: {
          doctor_id: schedule.Doctor.doctor_id,
          doctor_name: schedule.Doctor.User.username,
          doctor_title: schedule.Doctor.title,
          department_name: schedule.Doctor.Department.dept_name
        }
      };
    });
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        date: queryDate,
        doctor_id: doctorId,
        schedules: schedulesWithStatus,
        total_schedules: schedulesWithStatus.length,
        // 添加整体统计信息
        summary: {
          total_available_count: schedules.reduce((sum, s) => sum + s.available_count, 0),
          total_appointments_count: schedulesWithStatus.reduce((sum, s) => sum + s.total_appointments, 0),
          total_completed_count: schedulesWithStatus.reduce((sum, s) => sum + s.completed_count, 0)
        }
      }
    });
    
  } catch (error) {
    console.error('获取医生排班状态失败:', error);
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
        scheduleId: scheduleId,
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
    console.error('获取排班状态失败:', error);
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
    const { scheduleId, date, timeSlot, status } = req.query;
    const { userId, role } = req.user || {};

    // 角色校验
    if (!role || role !== 'doctor') {
      return res.status(403).json({
        code: 403,
        message: '仅医生可查询本人的就诊队列',
        data: null
      });
    }

    // 查医生档案
    const doctor = await Doctor.findOne({ where: { user_id: userId } });
    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '未找到医生信息',
        data: null
      });
    }

    // 确定排班
    let scheduleWhere = { doctor_id: doctor.doctor_id };
    if (scheduleId) {
      scheduleWhere.schedule_id = scheduleId;
    } else if (date && timeSlot) {
      scheduleWhere.schedule_date = date;
      scheduleWhere.time_slot = timeSlot;
      scheduleWhere.audit_status = 'approved';
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

    // 状态过滤：默认仅展示 pending + called 作为当前队列
    let statusFilter;
    if (status) {
      const list = Array.isArray(status) ? status : String(status).split(',');
      statusFilter = { [Op.in]: list };
    } else {
      statusFilter = { [Op.in]: ['pending', 'called'] };
    }

    const appointments = await Appointment.findAll({
      where: {
        schedule_id: schedule.schedule_id,
        is_valid: 1,
        status: statusFilter
      },
      include: [
        { model: User, attributes: ['user_id', 'username'] }
      ],
      order: [['serial_number', 'ASC']]
    });

    // 汇总计数
    const counts = {
      pending: appointments.filter(a => a.status === 'pending').length,
      called: appointments.filter(a => a.status === 'called').length,
      missed: appointments.filter(a => a.status === 'missed').length,
      completed: appointments.filter(a => a.status === 'completed').length
    };

    // 格式化队列
    const queue = appointments.map(a => ({
      appointmentId: a.appt_id,
      patientId: a.User.user_id,
      patientName: a.User.username,
      serialNumber: a.serial_number,
      status: a.status,
      statusDescription: getStatusDescription(a.status),
      appointmentTime: a.appointment_time
    }));

    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        schedule: {
          scheduleId: schedule.schedule_id,
          scheduleDate: schedule.schedule_date,
          timeSlot: schedule.time_slot,
          doctorId: schedule.Doctor.doctor_id,
          doctorName: schedule.Doctor.User.username,
          doctorTitle: schedule.Doctor.title,
          departmentName: schedule.Doctor.Department.dept_name,
          maxCount: schedule.max_count,
          availableCount: schedule.available_count
        },
        counts,
        queue,
        total: queue.length
      }
    });
  } catch (error) {
    console.error('医生队列查询失败:', error);
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
        attributes: ['schedule_date'],
        where: {
          doctor_id: doctorId,
          schedule_date: {
            [Op.between]: [startDate, endDateStr]
          }
        },
        group: ['schedule_date'],
        raw: true
      });
      
      // 确保正确处理日期格式，无论数据库返回的是什么类型
      const dates = schedules.map(s => {
        const date = s.schedule_date;
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
      attributes: ['schedule_date'],
      where: {
        doctor_id: userDoctorId,
        schedule_date: {
          [Op.between]: [startDate, endDateStr]
        }
      },
      group: ['schedule_date'],
      raw: true
    });
    
    // 确保正确处理日期格式，无论数据库返回的是什么类型
    const dates = schedules.map(s => {
      const date = s.schedule_date;
      if (date instanceof Date) {
        return date.toISOString().split('T')[0];
      } else if (typeof date === 'string') {
        return date.split('T')[0]; // 假设格式为 'YYYY-MM-DDTHH:mm:ss'
      }
      return date; // 如果是其他格式，直接返回
    });
    return res.status(200).json({ code: 200, message: '查询有排班日期成功', data: dates });
  } catch (error) {
    console.error('getScheduledDates error:', error);
    return res.status(500).json({ code: 500, message: '服务器错误' });
  }
};

// 2. 查询指定日期的排班详情
exports.getScheduleDetailsByDate = async (req, res) => {
  try {
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
        doctor_id: userDoctorId,
        schedule_date: date
      },
      order: [['time_slot', 'ASC']]
    });

    const formattedDetails = await Promise.all(schedules.map(async (schedule) => {
        // 统计当前排班下已预约人数
        const pendingAppointments = await Appointment.count({
            where: {
                schedule_id: schedule.scheduleId,
                is_valid: 1,
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
            pendingAppointments: pendingAppointments
        };
    }));

    return res.status(200).json({ code: 200, message: '查询排班详情成功', data: formattedDetails });
  } catch (error) {
    console.error('getScheduleDetailsByDate error:', error);
    return res.status(500).json({ code: 500, message: '服务器错误' });
  }
};

// 3. 医生请假（取消排班）
exports.requestLeaveForSchedule = async (req, res) => {
  const { scheduleId } = req.params; // 排班ID是从URL路径中获取的
  const { reason } = req.body;
  const { userId, role } = req.user;

  // 1. 角色和身份校验 (已解决)
  if (role !== 'doctor') {
    return res.status(403).json({ code: 403, message: '无权限：仅医生可进行请假操作' });
  }

  const doctor = await Doctor.findOne({ where: { userId: userId } }); // 假设已修正为 userId
  if (!doctor) {
    return res.status(403).json({ code: 403, message: '医生信息不存在或未绑定账号' });
  }
  
  const doctorId = doctor.doctorId; // 假设模型属性是 doctorId (驼峰)

  // 确保排班ID是数字
  const parsedScheduleId = parseInt(scheduleId, 10);
  if (isNaN(parsedScheduleId)) {
    return res.status(400).json({ code: 400, message: '排班ID格式错误' });
  }
  
  const transaction = await Appointment.sequelize.transaction();
  
  try {
    // 2. 查找排班记录并校验权限 (重点检查：scheduleId 和 doctorId 的字段名)
    const schedule = await Schedule.findOne({
      where: {
        scheduleId: parsedScheduleId, 
        doctorId: doctorId // 关键校验：排班必须属于当前医生
      },
      transaction
    });

    // ！！！ 关键日志，请检查终端输出 ！！！
    console.log(`[DEBUG 请假] 医生ID: ${doctorId}, 尝试请假排班ID: ${parsedScheduleId}`);
    
    if (!schedule) {
      await transaction.rollback();
      // 这里的 404 很可能就是因为 scheduleId 和 doctorId 不匹配！
      return res.status(404).json({ code: 404, message: '未找到该排班记录或无权限操作' });
    }
    
    // 3. 检查是否有待就诊/已叫号的预约
    const existingAppointments = await Appointment.findAll({
        where: { 
            scheduleId: parsedScheduleId, 
            isValid: 1, 
            status: { [Op.in]: ['pending', 'called'] } 
        },
        transaction 
    });

    if (existingAppointments.length > 0) {
        // 强制取消相关预约
        await Appointment.update({ 
            status: 'cancelled',
            // 实际项目中应记录请假原因
        }, { 
            where: { 
                scheduleId: parsedScheduleId, 
                isValid: 1, 
                status: { [Op.in]: ['pending', 'called'] } 
            }, 
            transaction 
        });
        console.warn(`强制取消了 ${existingAppointments.length} 个预约: Schedule ID ${parsedScheduleId}`);
    }

    // 4. 更新排班状态：可预约数归零
    await schedule.update({
      availableCount: 0,
      // 可以在Schedule模型中新增一个字段如 isCancelled: 1
    }, { transaction });

    await transaction.commit();

    return res.status(200).json({
      code: 200,
      message: `排班取消成功。${existingAppointments.length > 0 ? `已强制取消${existingAppointments.length}个预约。` : '无相关预约。'}`,
      data: {
        scheduleId: parsedScheduleId,
        reason: reason || '无具体原因',
      }
    });

  } catch (error) {
    await transaction.rollback();
    console.error(`请求请假失败 (Schedule ID ${scheduleId}):`, error);
    return res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
};