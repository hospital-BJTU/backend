const { Appointment, Schedule, Doctor, Department, User, CallLog } = require('../models');
const { Op } = require('sequelize');
require('dotenv').config();

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
        message: '具体时间段格式无效',
        data: null
      });
    }
    
    // 开始事务
    const transaction = await Schedule.sequelize.transaction();
    
    try {
      // 查找排班信息
      let schedule;
      
      if (scheduleId) {
        // 通过scheduleId查找排班
        schedule = await Schedule.findOne({
          where: { scheduleId, auditStatus: 'approved' },
          transaction
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
          transaction
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
        where: { scheduleId: schedule.scheduleId, isValid: 1 },
        transaction
      });
      const serialNumber = currentAppointmentsCount + 1;
      
      // 先查询当前最大的apptId值
      const maxIdResult = await Appointment.sequelize.query(
        'SELECT COALESCE(MAX(appt_id), 0) + 1 AS nextId FROM tb_appointment',
        { type: Appointment.sequelize.QueryTypes.SELECT, transaction }
      );
      const nextApptId = maxIdResult[0].nextId;
      
      // 创建预约记录，手动指定apptId
      const appointment = await Appointment.create({
        apptId: nextApptId,
        userId,
        scheduleId: schedule.scheduleId,
        serialNumber,
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
      await transaction.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('预约失败:', error);
    res.status(500).json({
      code: 500,
      message: '预约过程中发生错误',
      data: null
    });
  }
};

// 查询用户的预约列表
exports.getUserAppointments = async (req, res) => {
  try {
    const { userId } = req.user; // 从JWT中间件获取用户ID
    const { status, page = 1, limit = 10 } = req.query; // 添加分页参数和状态筛选
    
    // 计算偏移量
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // 构建查询条件
    const whereClause = { userId, isValid: 1 };
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
        appointmentId: appt.apptId,
        userId: appt.userId,
        // 医生信息
        doctorId: doctor ? doctor.doctorId : null,
        doctorName: user ? user.username : '未知医生',
        doctorTitle: doctor ? doctor.title : null,
        // 科室信息
        departmentId: department ? department.deptId : null,
        departmentName: department ? department.deptName : '未知科室',
        // 排班信息
        scheduleId: appt.Schedule ? appt.Schedule.scheduleId : null,
        scheduleDate: appt.Schedule ? appt.Schedule.scheduleDate : null,
        timeSlot: appt.Schedule ? appt.Schedule.timeSlot : null,
        // 预约信息
        serialNumber: appt.serialNumber,
        status: appt.status,
        statusDescription: getStatusDescription(appt.status),
        appointmentTime: appt.appointmentTime,
        // 预约创建时间
        createdAt: appt.appointmentTime // 使用appointmentTime作为创建时间
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

      // 记录叫号日志
      await CallLog.create({
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

      await CallLog.create({
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
    const { userId } = req.user; // 从JWT中间件获取用户ID
    
    // 开始事务
    const transaction = await Appointment.sequelize.transaction();
    
    try {
      // 查找预约信息
      const appointment = await Appointment.findOne({
        where: { apptId: apptId, userId, isValid: 1 },
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
      const schedule = await Schedule.findByPk(appointment.scheduleId, { transaction });
      await schedule.update({
        availableCount: schedule.availableCount + 1
      }, { transaction });
      
      // 提交事务
      await transaction.commit();
      
      return res.status(200).json({
        code: 200,
        message: '预约取消成功',
        data: {
          appointmentId: appointment.apptId,
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
    const { userId } = req.user; // 从JWT中间件获取用户ID
    
    // 查询预约详情
    const appointment = await Appointment.findOne({
      where: { apptId, userId, isValid: 1 },
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
        scheduleId: appointment.scheduleId, 
        isValid: 1,
        status: { [Op.in]: ['pending', 'called'] }
      },
      order: [['serialNumber', 'ASC']],
      attributes: ['serialNumber', 'status'],
      limit: 10 // 只显示前10个预约记录
    });
    
    // 计算前面等待人数
    const waitingCount = relatedAppointments.filter(appt => 
      appt.status === 'pending' && appt.serialNumber < appointment.serialNumber
    ).length;
    
    // 处理关联数据
    const doctor = appointment.Schedule.Doctor;
    const department = doctor.Department;
    const user = doctor.User;
    
    // 格式化返回数据
    const formattedAppointment = {
      // 预约ID和用户信息
      appointmentId: appointment.apptId,
      userId: appointment.userId,
      
      // 医生信息
      doctorId: doctor.doctorId,
      doctorName: user.username,
      doctorTitle: doctor.title,
      
      // 科室信息
      departmentId: department.deptId,
      departmentName: department.deptName,
      
      // 排班信息
      scheduleId: appointment.Schedule.scheduleId,
      scheduleDate: appointment.Schedule.scheduleDate,
      timeSlot: appointment.Schedule.timeSlot,
      
      // 预约信息
      serialNumber: appointment.serialNumber,
      status: appointment.status,
      statusDescription: getStatusDescription(appointment.status),
      appointmentTime: appointment.appointmentTime,
      
      // 排队信息
      waitingCount: waitingCount, // 前面等待人数
      queuePosition: relatedAppointments.findIndex(appt => appt.serialNumber === appointment.serialNumber) + 1,
      
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
    const timeSlotMapping = {
      'AM': ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00'],
      'PM': ['14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00']
    };
    
    // 构建查询条件
    const whereClause = {
      auditStatus: 'approved',
      availableCount: { [Op.gt]: 0 } // 余号数大于0
    };
    
    if (deptId) {
      whereClause.deptId = deptId;
    }
    
    if (date) {
      whereClause.scheduleDate = date;
    }
    
    if (doctorId) {
      whereClause.doctorId = doctorId;
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
      const specificTimeSlots = timeSlotMapping[schedule.timeSlot] || [];
      
      return {
        scheduleId: schedule.scheduleId,
        doctorId: schedule.Doctor.doctorId,
        doctorName: schedule.Doctor.User.username,
        doctorTitle: schedule.Doctor.title,
        departmentName: schedule.Doctor.Department.deptName,
        scheduleDate: schedule.scheduleDate,
        timeSlot: schedule.timeSlot,
        specificTimeSlots: specificTimeSlots, // 添加具体时间段选项
        availableCount: schedule.availableCount,
        maxCount: schedule.maxCount
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