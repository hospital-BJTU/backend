const { Appointment, Schedule, Doctor, Department, User } = require('../models');
const { Op } = require('sequelize');

// 创建预约（患者端）
exports.createAppointment = async (req, res) => {
  try {
    const { scheduleId} = req.body;
    const userId = req.user ? req.user.user_id : null;
    
    // 参数验证
    if (!scheduleId || !userId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：scheduleId 或 userId',
        data: null
      });
    }

    // 检查用户是否已经在同一天同一个医生处预约过
    const existingAppointment = await Appointment.findOne({
      where: {
        user_id: userId,
        schedule_id: scheduleId
      }
    });

    if (existingAppointment) {
      return res.status(400).json({
        code: 400,
        message: '您已经在该排班下有预约记录，请不要重复预约',
        data: null
      });
    }

    // 开始事务
    const transaction = await Appointment.sequelize.transaction();
    
    try {
      // 1. 检查排班是否存在且有可用号源
      const schedule = await Schedule.findOne({
        where: { scheduleId },
        transaction
      });
      
      if (!schedule || schedule.availableCount <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '该排班不可用或号源已用完',
          data: null
        });
      }

      // 2. 为当前排班生成新的序列号
      let serialNumber;
      let maxAttempts = 10; // 最大尝试次数
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        // 获取当前最大序列号
        const maxSerial = await Appointment.max('serialNumber', {
          where: { scheduleId },
          transaction
        });
        
        serialNumber = (maxSerial || 0) + 1;
        
        // 尝试创建预约记录（包括序列号）
        try {
          // 使用Sequelize的create方法（会自动使用数据库自增ID）
          const appointment = await Appointment.create({
            userId,
            scheduleId,
            serialNumber,
            status: 'pending',
            scheduleDate: schedule.scheduleDate,
            appointmentTime: new Date(),
            isValid: 1
          }, { transaction });
          
          // 3. 更新排班的可用号源
          await schedule.update({
            availableCount: schedule.availableCount - 1
          }, { transaction });
          
          // 4. 提交事务
          await transaction.commit();
          
          // 5. 返回预约信息
          return res.status(201).json({
            code: 201,
            message: '预约成功',
            data: {
              appointmentId: appointment.apptId,
              serialNumber: appointment.serialNumber,
              scheduleId: appointment.scheduleId,
              status: appointment.status,
              statusDescription: getStatusDescription(appointment.status)
            }
          });
        } catch (error) {
          // 如果是因为序列号冲突导致的错误，继续尝试
          if (error.name === 'SequelizeUniqueConstraintError') {
            attempts++;
            if (attempts >= maxAttempts) {
              throw new Error('创建预约失败：序列号生成冲突，请稍后重试');
            }
            // 短暂延迟后重试
            await new Promise(resolve => setTimeout(resolve, 100));
          } else {
            // 其他错误直接抛出
            throw error;
          }
        }
      }
    } catch (error) {
      // 回滚事务
      await transaction.rollback();
      console.error('创建预约事务回滚:', error);
      return res.status(500).json({
        code: 500,
        message: '创建预约过程中发生错误',
        data: null
      });
    }
  } catch (error) {
    console.error('预约失败:', error);
    res.status(500).json({
      code: 500,
      message: '预约过程中发生错误: ' + (error.message || String(error)),
      data: null
    });
  }
};

// 查询用户的预约列表（患者端）
exports.getUserAppointments = async (req, res) => {
  try {
    const { user_id } = req.user; // 从JWT中间件获取用户ID
    const { status, page = 1, limit = 10 } = req.query; // 添加分页参数和状态筛选
    
    // 计算偏移量
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // 构建查询条件
    const whereClause = { 
      user_id: user_id, 
      is_valid: 1,
      // 默认排除已取消的预约
      ...(!status ? { status: { [Op.ne]: 'cancelled' } } : {})
    };
    if (status) {
      whereClause.status = status;
    }
    
    // 查询预约总数（用于分页）
    const totalCount = await Appointment.count({ where: whereClause });
    
    // 查询用户预约记录
    const appointments = await Appointment.findAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: offset,
      order: [['appointmentTime', 'DESC']],
      include: [
        {
          model: Schedule,
          required: true, // 使用INNER JOIN确保必须有排班记录
          include: [
            {
              model: Doctor,
              required: true, // 使用INNER JOIN确保必须有医生记录
              include: [
                { 
                  model: Department, 
                  required: true, // 使用INNER JOIN确保必须有科室记录
                  attributes: ['deptId', 'deptName'] 
                },
                { 
                  model: User, 
                  required: true, // 使用INNER JOIN确保必须有用户记录
                  attributes: ['userId', 'username'] 
                }
              ]
            }
          ]
        }
      ]
    });
    
    // 格式化返回数据
    const formattedAppointments = appointments.map(appt => {
      // 处理可能为null的关联数据
      const doctor = appt.Schedule ? appt.Schedule.Doctor : null;
      const department = doctor ? doctor.Department : null;
      const user = doctor ? doctor.User : null;
      
      return {
        appointment_id: appt.appt_id,
        user_id: appt.user_id,
        // 医生信息
        doctor_id: doctor ? doctor.doctor_id : null,
        doctor_name: user ? user.username : '未知医生',
        doctor_title: doctor ? doctor.title : null,
        // 科室信息
        department_id: department ? department.dept_id : null,
        department_name: department ? department.dept_name : '未知科室',
        // 排班信息
        schedule_id: appt.Schedule ? appt.Schedule.schedule_id : null,
        schedule_date: appt.Schedule ? appt.Schedule.schedule_date : null,
        time_slot: appt.Schedule ? appt.Schedule.time_slot : null,
        // 预约信息
        serial_number: appt.serial_number,
        status: appt.status,
        status_description: getStatusDescription(appt.status),
        appointment_time: appt.appointment_time,
        // 预约创建时间
        created_at: appt.appointment_time // 使用appointment_time作为创建时间
      };
    });
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        appointments: formattedAppointments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
    
  } catch (error) {
    console.error('查询用户预约列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};

// 取消预约（患者端）
exports.cancelAppointment = async (req, res) => {
  try {
    const { apptId } = req.params;
    const { user_id } = req.user; // 从JWT中间件获取用户ID
    
    // 开始事务
    const transaction = await Appointment.sequelize.transaction();
    
    try {
      // 查找预约信息
      const appointment = await Appointment.findOne({
        where: { appt_id: apptId, user_id: user_id, is_valid: 1 },
        transaction
      });
      
      if (!appointment) {
        await transaction.rollback();
        return res.status(404).json({
          code: 404,
          message: '未找到有效的预约信息',
          data: null
        });
      }
      
      // 检查是否可以取消（只有待就诊和待叫号状态可以取消）
      if (!['pending', 'called'].includes(appointment.status)) {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '当前预约状态不允许取消',
          data: null
        });
      }
      
      // 更新预约状态为已取消
      await appointment.update({
        status: 'cancelled',
        is_valid: 0
      }, { transaction });
      
      // 恢复排班余号数（使用原子更新SQL避免并发更新丢失问题）
      await Schedule.sequelize.query(
        'UPDATE tb_schedule SET available_count = available_count + 1 WHERE schedule_id = :scheduleId',
        {
          replacements: { scheduleId: appointment.schedule_id },
          transaction,
          type: Schedule.sequelize.QueryTypes.UPDATE
        }
      );
      
      // 提交事务
      await transaction.commit();
      
      return res.status(200).json({
        code: 200,
        message: '预约取消成功',
        data: {
          appointment_id: appointment.appt_id,
          status: 'cancelled'
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('取消预约失败:', error);
    res.status(500).json({
      code: 500,
      message: '取消预约过程中发生错误',
      data: null
    });
  }
};

// 查询预约详情（患者端）
exports.getAppointmentDetail = async (req, res) => {
  try {
    const { apptId } = req.params;
    const { user_id } = req.user; // 从JWT中间件获取用户ID
    
    // 查询预约详情
    const appointment = await Appointment.findOne({
      where: { 
        appt_id: apptId, 
        user_id: user_id, 
        is_valid: 1,
        // 默认排除已取消的预约
        status: { [Op.ne]: 'cancelled' }
      },
      include: [
        {
          model: Schedule,
          required: true, // 使用INNER JOIN确保必须有排班记录
          include: [
            {
              model: Doctor,
              required: true, // 使用INNER JOIN确保必须有医生记录
              include: [
                { 
                  model: Department, 
                  required: true, // 使用INNER JOIN确保必须有科室记录
                  attributes: ['deptId', 'deptName'] 
                },
                { 
                  model: User, 
                  required: true, // 使用INNER JOIN确保必须有用户记录
                  attributes: ['userId', 'username'] 
                }
              ]
            }
          ]
        }
      ]
    });
    
    if (!appointment) {
      return res.status(404).json({
        code: 404,
        message: '未找到有效的预约信息',
        data: null
      });
    }
    
    // 查询相同排班下的其他预约信息（用于显示排队情况）
    const relatedAppointments = await Appointment.findAll({
      where: { 
        schedule_id: appointment.schedule_id, 
        is_valid: 1,
        status: { [Op.in]: ['pending', 'called'] }
      },
      order: [['serial_number', 'ASC']],
      attributes: ['serial_number', 'status'],
      limit: 10 // 只显示前10个预约记录
    });
    
    // 计算前面等待人数
    const waitingCount = relatedAppointments.filter(appt => 
      appt.status === 'pending' && appt.serial_number < appointment.serial_number
    ).length;
    
    // 处理关联数据
    const doctor = appointment.Schedule.Doctor;
    const department = doctor.Department;
    const user = doctor.User;
    
    // 格式化返回数据
    const formattedAppointment = {
      // 预约ID和用户信息
      appointment_id: appointment.appt_id,
      user_id: appointment.user_id,
      
      // 医生信息
      doctor_id: doctor.doctor_id,
      doctor_name: user.username,
      doctor_title: doctor.title,
      
      // 科室信息
      department_id: department.dept_id,
      department_name: department.dept_name,
      
      // 排班信息
      schedule_id: appointment.Schedule.schedule_id,
      schedule_date: appointment.Schedule.schedule_date,
      time_slot: appointment.Schedule.time_slot,
      
      // 预约信息
      serial_number: appointment.serial_number,
      status: appointment.status,
      statusDescription: getStatusDescription(appointment.status),
      appointmentTime: appointment.appointmentTime,
      
      // 排队信息
      waiting_count: waitingCount, // 前面等待人数
      queue_position: relatedAppointments.findIndex(appt => appt.serial_number === appointment.serial_number) + 1,
      
      // 添加预计就诊时间（如果可以计算）
      estimatedTime: appointment.status === 'pending' ? 
        calculateEstimatedTime(appointment.Schedule.scheduleDate, appointment.Schedule.timeSlot, waitingCount) : null
    };
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: formattedAppointment
    });
    
  } catch (error) {
    console.error('查询预约详情失败:', error);
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};

// 查询可预约的排班列表（患者端）
exports.getAvailableSchedules = async (req, res) => {
  try {
    const { deptId, date, doctorId } = req.query;
    
    // 定义具体时间段映射
    const time_slot_mapping = {
      'AM': ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00'],
      'PM': ['14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00']
    };
    
    // 构建查询条件
    const whereClause = {
      audit_status: 'approved',
      available_count: { [Op.gt]: 0 } // 余号数大于0
    };
    
    if (deptId) {
      whereClause.dept_id = deptId;
    }
    
    if (date) {
      whereClause.schedule_date = date;
    }
    
    if (doctorId) {
      whereClause.doctor_id = doctorId;
    }
    
    // 查询可预约的排班
    const schedules = await Schedule.findAll({
      where: whereClause,
      include: [
        {
          model: Doctor,
          include: [
            { model: Department },
            { model: User, attributes: ['username'] }
          ]
        }
      ],
      order: [
        ['schedule_date', 'ASC'],
        ['time_slot', 'ASC']
      ]
    });
    
    // 格式化返回数据，添加具体时间段选项
    const formattedSchedules = schedules.map(schedule => {
      // 根据班次(AM/PM)获取对应的具体时间段列表
      const specific_time_slots = time_slot_mapping[schedule.time_slot] || [];
      
      return {
        schedule_id: schedule.schedule_id,
        doctor_id: schedule.Doctor.doctor_id,
        doctor_name: schedule.Doctor.User.username,
        doctor_title: schedule.Doctor.title,
        department_name: schedule.Doctor.Department.dept_name,
        schedule_date: schedule.schedule_date,
        time_slot: schedule.time_slot,
        specific_time_slots: specific_time_slots, // 添加具体时间段选项
        available_count: schedule.available_count,
        max_count: schedule.max_count
      };
    });
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        schedules: formattedSchedules,
        total: formattedSchedules.length
      }
    });
    
  } catch (error) {
    console.error('查询可预约排班失败:', error);
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};

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

// 计算预计就诊时间
function calculateEstimatedTime(scheduleDate, timeSlot, waitingCount) {
  try {
    const baseTime = timeSlot === 'AM' ? '09:00' : '14:00';
    const averageConsultationTime = 15; // 平均就诊时间15分钟
    const waitingTime = waitingCount * averageConsultationTime;
    
    const [hours, minutes] = baseTime.split(':').map(Number);
    const date = new Date(scheduleDate);
    date.setHours(hours, minutes + waitingTime);
    
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  } catch (error) {
    console.error('计算预计就诊时间失败:', error);
    return null;
  }
}