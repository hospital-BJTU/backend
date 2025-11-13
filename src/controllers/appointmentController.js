// 正确导入模型，确保使用初始化后的模型实例
const models = require('../models');
const { Op, Transaction } = require('sequelize');
require('dotenv').config();

// 从初始化后的模型中获取实例
const Appointment = models.Appointment;
const Schedule = models.Schedule;
const Doctor = models.Doctor;
const Department = models.Department;
const User = models.User;

// 创建预约（挂号）
exports.createAppointment = async (req, res) => {
  try {
    const { scheduleId, doctorId, scheduleDate, timeSlot, specificTimeSlot } = req.body;
    const { userId } = req.user; // 从JWT中间件获取用户ID
    
    // 基本验证 - 支持两种方式：1. 直接提供scheduleId  2. 提供doctorId、scheduleDate和timeSlot组合
    if (!scheduleId && (!doctorId || !scheduleDate || !timeSlot)) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数，请提供scheduleId或(doctorId、scheduleDate和timeSlot组合)',
        data: null
      });
    }
    
    // 验证specificTimeSlot的格式（如果提供）
    if (specificTimeSlot && typeof specificTimeSlot !== 'string') {
      return res.status(400).json({
        code: 400,
        message: '具体时间段格式错误',
        data: null
      });
    }
    
    // 开始事务
    const transaction = await Schedule.sequelize.transaction();
    
    try {
      // *** 新增：排他锁配置 ***
    const lockOptions = { 
      transaction, 
      lock: transaction.LOCK.UPDATE // <-- 核心优化：施加排他锁
    };
      // 查找排班信息
      let schedule;
      
      if (scheduleId) {
        // 通过scheduleId查找排班
        schedule = await Schedule.findOne({
          where: { scheduleId, auditStatus: 'approved' },
          ...lockOptions
        });
      } else {
        // 通过doctorId、scheduleDate和timeSlot组合查找排班
        schedule = await Schedule.findOne({
          where: { 
            doctorId, 
            scheduleDate, 
            timeSlot,
            auditStatus: 'approved' 
          },
          ...lockOptions
        });
      }
      
      if (!schedule) {
        await transaction.rollback();
        return res.status(404).json({
          code: 404,
          message: '未找到有效的排班信息',
          data: null
        });
      }
      
      // 检查是否还有号源
      if (schedule.availableCount <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '该时间段号源已用尽',
          data: null
        });
      }
      
      // 计算当前患者的顺序号
      const currentAppointmentsCount = await Appointment.count({
      where: { scheduleId: schedule.scheduleId /* <-- 移除 isValid: 1 */ },
      transaction
    });
      const serialNumber = currentAppointmentsCount + 1;
      
      // 先查询当前最大的apptId值
      const maxIdResult = await Appointment.sequelize.query(
        'SELECT COALESCE(MAX(appt_id), 0) + 1 AS nextId FROM tb_appointment',
        { type: Appointment.sequelize.QueryTypes.SELECT, transaction }
      );
      
      // 创建预约记录，手动指定apptId
      const appointment = await Appointment.create({
        //apptId: nextApptId,
        userId,
        scheduleId: schedule.scheduleId,
        doctorId: schedule.doctorId, // 添加医生ID
        serialNumber,
        scheduleDate: schedule.scheduleDate, // 从排班对象中获取日期
        status: 'pending',
        isValid: 1,
        appointmentTime: new Date()
      }, { transaction });
      
      // 更新排班余号数
      await schedule.update({
        availableCount: schedule.availableCount - 1
      }, { transaction });
      
      // 提交事务
      await transaction.commit();
      
      // 查询完整的预约信息返回给用户
      const fullAppointmentInfo = await Appointment.findOne({
        where: { apptId: appointment.apptId },
        include: [
          {
            model: Schedule,
            include: [
              {
                model: Doctor,
                include: [
                  { model: Department },
                  { model: User, attributes: ['username'] }
                ]
              }
            ]
          }
        ]
      });
      
      return res.status(201).json({
        code: 201,
        message: '预约成功',
        data: {
          appointmentId: fullAppointmentInfo.apptId,
          doctorName: fullAppointmentInfo.Schedule.Doctor.User.username,
          departmentName: fullAppointmentInfo.Schedule.Doctor.Department.deptName,
          scheduleDate: fullAppointmentInfo.Schedule.scheduleDate,
          timeSlot: fullAppointmentInfo.Schedule.timeSlot,
          specificTimeSlot: specificTimeSlot || null, // 返回具体时间段（如果提供）
          serialNumber: fullAppointmentInfo.serialNumber,
          status: fullAppointmentInfo.status,
          appointmentTime: fullAppointmentInfo.appointmentTime
        }
      });
      
    } catch (error) {
        // 事务回滚
        if (transaction && transaction.finished !== 'commit') {
            await transaction.rollback();
        }
        console.error('创建预约失败:', error);
        res.status(500).json({
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

      // 业务规则：只有已叫号的预约可以标记为完成
      if (appointment.status !== 'called') {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '当前预约状态不允许接诊完成（需先叫号）',
          data: { status: appointment.status, statusDescription: getStatusDescription(appointment.status) }
        });
      }

      await appointment.update({ status: 'completed' }, { transaction });

      // 记录完成日志（数据库无自增，手动分配log_id）
      const nextCompletedLogIdResult = await CallLog.sequelize.query(
        'SELECT COALESCE(MAX(log_id), 0) + 1 AS nextId FROM tb_call_log',
        { type: CallLog.sequelize.QueryTypes.SELECT, transaction }
      );
      const nextCompletedLogId = nextCompletedLogIdResult[0].nextId;
      await CallLog.create({
        logId: nextCompletedLogId,
        apptId: appointment.apptId,
        doctorId: doctor.doctorId,
        operation: 'completed',
        operationTime: new Date()
      }, { transaction });

      await transaction.commit();

      return res.status(200).json({
        code: 200,
        message: '已标记接诊完成',
        data: {
          appointmentId: appointment.apptId,
          status: 'completed',
          statusDescription: getStatusDescription('completed')
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

// 查询用户的预约列表
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

      // 更新状态为已叫号
      await appointment.update({ status: 'called' }, { transaction });

      // 记录叫号日志（数据库无自增，手动分配log_id）
      const nextCallLogIdResult = await CallLog.sequelize.query(
        'SELECT COALESCE(MAX(log_id), 0) + 1 AS nextId FROM tb_call_log',
        { type: CallLog.sequelize.QueryTypes.SELECT, transaction }
      );
      const nextCallLogId = nextCallLogIdResult[0].nextId;
      await CallLog.create({
        logId: nextCallLogId,
        apptId: appointment.apptId,
        doctorId: doctor.doctorId,
        operation: 'called',
        operationTime: new Date()
      }, { transaction });

      await transaction.commit();

      return res.status(200).json({
        code: 200,
        message: '叫号成功',
        data: {
          appointmentId: appointment.apptId,
          status: 'called',
          statusDescription: getStatusDescription('called')
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

      // 业务规则：通常只有已叫号才能标记过号
      if (appointment.status !== 'called') {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '当前预约状态不允许过号（需先叫号）',
          data: { status: appointment.status, statusDescription: getStatusDescription(appointment.status) }
        });
      }

      await appointment.update({ status: 'missed' }, { transaction });

      // 记录过号日志（数据库无自增，手动分配log_id）
      const nextMissLogIdResult = await CallLog.sequelize.query(
        'SELECT COALESCE(MAX(log_id), 0) + 1 AS nextId FROM tb_call_log',
        { type: CallLog.sequelize.QueryTypes.SELECT, transaction }
      );
      const nextMissLogId = nextMissLogIdResult[0].nextId;
      await CallLog.create({
        logId: nextMissLogId,
        apptId: appointment.apptId,
        doctorId: doctor.doctorId,
        operation: 'missed',
        operationTime: new Date()
      }, { transaction });

      await transaction.commit();

      return res.status(200).json({
        code: 200,
        message: '已标记过号',
        data: {
          appointmentId: appointment.apptId,
          status: 'missed',
          statusDescription: getStatusDescription('missed')
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

// 取消预约
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
      
      // 恢复排班余号数
      const schedule = await Schedule.findByPk(appointment.schedule_id, { transaction });
      await schedule.update({
        available_count: schedule.available_count + 1
      }, { transaction });
      
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

// 查询预约详情
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

// 查询可预约的排班列表
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
    const doctor = await Doctor.findOne({ where: { userId: userId } });
    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '未找到医生信息',
        data: null
      });
    }

    // 确定排班
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
        scheduleId: schedule.scheduleId,
        isValid: 1,
        status: statusFilter
      },
      include: [
        { model: User, attributes: ['userId', 'username'] }
      ],
      order: [['serialNumber', 'ASC']]
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
      appointmentId: a.apptId,
      patientId: a.User.userId,
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
          departmentName: schedule.Doctor.Department.deptName,
          maxCount: schedule.maxCount,
          availableCount: schedule.availableCount
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
};