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
    // 添加兼容层，同时支持userId和user_id
    const user_id = req.user?.user_id || req.user?.userId;
    console.log('用户认证信息:', req.user, '使用的user_id:', user_id);
    
    if (!user_id) {
      console.error('认证失败: 无法从req.user中获取到有效的user_id');
      return res.status(401).json({
        code: 401,
        message: '用户认证信息缺失或无效，请重新登录',
        data: null
      });
    }
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
        message: '具体时间段格式无效',
        data: null
      });
    }
    
    // 开始事务，使用SERIALIZABLE隔离级别以获得最高并发安全性
    // 使用模型中已配置的sequelize实例，确保一致性
    const sequelize = models.sequelize;
    console.log('开始创建预约，用户ID:', user_id, '排班ID:', scheduleId, '医生ID:', doctorId);
    const transaction = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE
    });
    
    try {
      // 查找排班信息，使用行级锁定（LOCK IN SHARE MODE）防止其他事务修改
      let schedule;
      let actualScheduleId;
      
      if (scheduleId) {
        // 通过scheduleId查找排班
        schedule = await Schedule.findOne({
          where: { schedule_id: scheduleId, audit_status: 'approved' },
          lock: true, // 在Sequelize中使用行级锁定
          transaction
        });
        actualScheduleId = scheduleId;
      } else {
        // 通过doctorId、scheduleDate和timeSlot组合查找排班
        schedule = await Schedule.findOne({
          where: { 
            doctor_id: doctorId, 
            schedule_date: scheduleDate, 
            time_slot: timeSlot,
            audit_status: 'approved' 
          },
          lock: true, // 在Sequelize中使用行级锁定
          transaction
        });
        actualScheduleId = schedule?.schedule_id;
      }
      
      if (!schedule) {
        await transaction.rollback();
        return res.status(404).json({
          code: 404,
          message: '未找到有效的排班信息',
          data: null
        });
      }
      
      // 再次检查是否还有号源（使用锁定后的值，确保一致性）
      if (schedule.available_count <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '该时间段号源已用尽',
          data: null
        });
      }
      
      // 检查用户是否已经在该排班下有有效的预约（防止重复预约）
      const existingAppointment = await Appointment.findOne({
        where: { 
          user_id: user_id, 
          schedule_id: actualScheduleId,
          is_valid: 1
        },
        transaction
      });
      
      if (existingAppointment) {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '您已经在该时间段预约过了，请勿重复预约',
          data: null
        });
      }
      
      // 使用原子操作来计算序号和更新号源，避免竞争条件
      // 1. 原子更新号源数量（减少1）
      const [updated] = await Schedule.update(
        { available_count: Schedule.sequelize.literal('available_count - 1') },
        {
          where: {
            schedule_id: actualScheduleId,
            available_count: { [Op.gt]: 0 } // 确保号源仍然大于0
          },
          transaction,
          returning: true
        }
      );
      
      // 检查更新是否成功（如果没有更新成功，说明号源在锁定期间被其他事务占用）
      if (updated === 0) {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '该时间段号源已被其他用户预约，请刷新页面重新选择',
          data: null
        });
      }
      
      // 重新查询更新后的排班信息
      const updatedSchedule = await Schedule.findOne({
        where: { schedule_id: actualScheduleId },
        transaction
      });
      
      // 计算当前患者的顺序号（使用max_count - available_count来计算，更准确）
      const serialNumber = schedule.max_count - updatedSchedule.available_count;
      
      // 改用Sequelize的create方法，让ORM自动处理自增主键
      const createdAppointment = await Appointment.create({
        user_id: user_id,
        schedule_id: actualScheduleId,
        serial_number: serialNumber,
        status: 'pending',
        is_valid: 1,
        appointment_time: new Date()
      }, { transaction });
      
      // 获取创建后的主键值
      const apptId = createdAppointment.appt_id;
      
      // 构建返回的appointment对象
      const appointment = { apptId: createdAppointment.appt_id };
      
      // 提交事务
      await transaction.commit();
      
      // 查询完整的预约信息返回给用户
      const fullAppointmentInfo = await Appointment.findOne({
        where: { appt_id: appointment.apptId },
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
          appointmentId: fullAppointmentInfo.appt_id,
          doctorName: fullAppointmentInfo.Schedule.Doctor.User.username,
          department_name: fullAppointmentInfo.Schedule.Doctor.Department.dept_name,
        schedule_date: fullAppointmentInfo.Schedule.schedule_date,
        time_slot: fullAppointmentInfo.Schedule.time_slot,
        specific_time_slot: specificTimeSlot || null, // 返回具体时间段（如果提供）
        serial_number: fullAppointmentInfo.serial_number,
        status: fullAppointmentInfo.status,
        appointment_time: fullAppointmentInfo.appointment_time
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    
  } catch (error) {
    // 发生错误，记录详细错误信息
    console.error('预约失败错误详情:', error);
    // 返回错误信息
    res.status(500).json({
      code: 500,
      message: '预约过程中发生错误: ' + (error.message || String(error)),
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
    const whereClause = { user_id: user_id, is_valid: 1 };
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
        isValid: 0
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
        where: { appt_id: apptId, user_id: user_id, is_valid: 1 },
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
      status_description: getStatusDescription(appointment.status),
      appointment_time: appointment.appointmentTime,
      
      // 排队信息
      waiting_count: waitingCount, // 前面等待人数
      queue_position: relatedAppointments.findIndex(appt => appt.serial_number === appointment.serial_number) + 1,
      
      // 添加预计就诊时间（如果可以计算）
      estimated_time: appointment.status === 'pending' ? 
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
        ['scheduleDate', 'ASC'],
        ['timeSlot', 'ASC']
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