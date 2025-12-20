const { Appointment, Schedule, Doctor, Department, User, UserProfile } = require('../models');
const { Op } = require('sequelize');
const AntiHoardingLogModel = require('../models/AntiHoardingLog');
const AntiHoardingLog = AntiHoardingLogModel.getModel();

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
    // 从具体时间段中提取开始时间（例如：从'08:00-09:00'提取'08:00'）
    const baseTime = timeSlot.split('-')[0] || '09:00';
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

// 创建预约（患者端）
exports.createAppointment = async (req, res) => {
  try {
    console.log('=== 预约创建方法开始 ===');
    console.log('请求路径:', req.path);
    console.log('请求方法:', req.method);
    console.log('请求体:', JSON.stringify(req.body));
    console.log('req.user内容:', JSON.stringify(req.user));
    console.log('req.user存在性:', !!req.user);
    console.log('req.user.user_id存在性:', !!req.user?.user_id);
    console.log('req.user.userId存在性:', !!req.user?.userId);
    // 请求体存在性检测
    if (!req.body) {
      return res.status(400).json({
        code: 400,
        message: '请求体不能为空',
        data: null
      });
    }
    
    // 用户信息空值检测
    console.log('=== 检查用户登录状态 ===');
    console.log('req.user:', JSON.stringify(req.user));
    // 用户登录状态检查 - 同时检查user_id和userId属性以确保兼容性
    if (!req.user || (!req.user.user_id && !req.user.userId)) {
      console.log('用户未登录，req.user:', req.user);
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    console.log('用户登录状态检查通过，用户ID:', req.user.user_id);
    
    const { scheduleId} = req.body;
    const userId = req.user.user_id;
    
    // 参数验证
    if (!scheduleId || !userId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：scheduleId 或 userId',
        data: null
      });
    }
    
    // 将scheduleId转换为数字类型
    const numericScheduleId = parseInt(scheduleId, 10);
    if (isNaN(numericScheduleId)) {
      return res.status(400).json({
        code: 400,
        message: '无效的排班ID格式',
        data: null
      });
    }
    
    // 检查用户短时间内的预约频率（业务层面防抢号）
    const recentAppointments = await Appointment.count({
      where: {
        userId: userId,
        appointmentTime: {
          [Op.gt]: new Date(Date.now() - 5 * 60 * 1000) // 5分钟内的预约
        },
        status: ['pending', 'called']
      }
    });
    
    if (recentAppointments >= 2) {
      // 记录可疑的抢号行为
      await AntiHoardingLog.create({
        userId: userId,
        ipAddress: req.ip,
        requestTime: new Date(),
        logType: 'user_hoarding_attempt'
      });
      
      return res.status(429).json({
        code: 429,
        message: '您在短时间内预约过于频繁，请稍后再试',
        data: null
      });
    }

    // 检查用户是否已经在该排班下有预约记录
    const existingAppointment = await Appointment.findOne({
      where: {
        userId: userId,
        scheduleId: numericScheduleId
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
      // 查找排班信息，使用lock: true来确保并发安全
      const schedule = await Schedule.findOne({
        where: { scheduleId: numericScheduleId, auditStatus: 'approved' },
        transaction,
        lock: true
      });
      
      if (!schedule || schedule.availableCount <= 0) {
        await transaction.rollback();
        return res.status(400).json({
          code: 400,
          message: '该排班不可用或号源已用完',
          data: null
        });
      }
      
      // 使用SELECT MAX(serial_number) FOR UPDATE来确保并发安全的序列号计算
      const maxSerialResult = await Appointment.sequelize.query(
        'SELECT COALESCE(MAX(serial_number), 0) + 1 AS nextSerial FROM tb_appointment WHERE schedule_id = ? AND is_valid = 1 FOR UPDATE',
        { replacements: [schedule.scheduleId], type: Appointment.sequelize.QueryTypes.SELECT, transaction }
      );
      const serialNumber = maxSerialResult[0].nextSerial;
      
      // 创建预约记录，让数据库自动处理apptId主键自增
      const appointment = await Appointment.create({
        userId,
        scheduleId: numericScheduleId,
        scheduleDate: schedule.scheduleDate, // 从排班记录中获取就诊日期
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
    console.error('错误堆栈:', error.stack);
    res.status(500).json({
      code: 500,
      message: '预约失败',
      data: null
    });
  }
};

  // 新增：获取有排班的医生列表（支持按科室筛选）
  exports.getDoctorsByDept = async (req, res) => {
    try {
    const { deptId, date } = req.query; // 接收科室ID和可选日期

          // 构建Schedule查询条件 (与原逻辑相同)
      const scheduleWhere = { 
        auditStatus: 'approved',
        availableCount: { [Op.gt]: 0 } // 只显示有余号的排班
      }; 
      if (date) {
        scheduleWhere.scheduleDate = date;
      }

      // 构建Doctor查询条件
      const doctorWhere = {};
      if (deptId) {
        doctorWhere.deptId = deptId;
      }

      const doctors = await Doctor.findAll({
        where: doctorWhere,
        include: [
          { model: User, attributes: ['username'] }, // 获取医生姓名
          { 
            model: Schedule,
            // 这里的 attributes 可以精简，因为我们只关心是否有排班，不需返回所有排班字段
            attributes: [], 
            where: scheduleWhere,
            required: true // 确保只有有排班的医生才会被返回
          }
        ],
        // attributes: ['doctorId', 'title'], // 移除这行，让 Sequelize 自带 Doctor 的所有属性
        order: [[User, 'username', 'ASC']], // 按 User 模型中的 username 排序
        distinct: true, // 关键：使用 distinct 来确保返回唯一的医生
        col: 'doctorId' // 关键：告知 Sequelize 以 Doctor 的主键进行去重
      });

    // 格式化返回数据
    const formattedDoctors = doctors.map(doctor => ({
      doctorId: doctor.doctorId,
      doctorName: doctor.User.username,
      title: doctor.title
    }));

    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        doctors: formattedDoctors
      }
    });
  } catch (error) {
    console.error('查询医生列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};



// 新增：获取所有科室列表
exports.getAllDepartments = async (req, res) => {
  try {
    // 逻辑：查询 Department 模型，返回 deptId 和 deptName
    const departments = await Department.findAll({
      attributes: ['deptId', 'deptName'],
      order: [['deptName', 'ASC']]
    });
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        departments: departments
      }
    });
  } catch (error) {
    console.error('查询科室列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};

// 查询用户的预约列表（患者端）
exports.getUserAppointments = async (req, res) => {
  try {
    // 用户信息空值检测
    if (!req.user || !req.user.user_id) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const { user_id } = req.user; // 从JWT中间件获取用户ID
    const { status, page = 1, limit = 10 } = req.query; // 添加分页参数和状态筛选
    
    // 计算偏移量
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // 构建查询条件
    const whereClause = { 
      userId: user_id, 
      isValid: 1,
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

// 取消预约
exports.cancelAppointment = async (req, res) => {
  try {
    // 用户信息空值检测
    if (!req.user || !req.user.user_id) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    // 预约ID空值检测
    if (!req.params || !req.params.apptId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：apptId',
        data: null
      });
    }
    
    const { apptId } = req.params;
    const { user_id } = req.user; // 从JWT中间件获取用户ID
    
    // 开始事务
    const transaction = await Appointment.sequelize.transaction();
    
    try {
      // 查找预约信息
      const appointment = await Appointment.findOne({
        where: { apptId: apptId, userId: user_id, isValid: 1 },
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
        status: 'cancelled'
        // 移除isValid: 0的设置，保留为1以便在历史记录中查询
      }, { transaction });
      
      // 恢复排班余号数（使用原子更新SQL避免并发更新丢失问题）
      await Schedule.sequelize.query(
        'UPDATE tb_schedule SET available_count = available_count + 1 WHERE schedule_id = :scheduleId',
        {
          replacements: { scheduleId: appointment.scheduleId },
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

// 查询预约详情（患者端）
exports.getAppointmentDetail = async (req, res) => {
  try {
    // 用户信息空值检测
    if (!req.user || !req.user.user_id) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    // 预约ID空值检测
    if (!req.params || !req.params.apptId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：apptId',
        data: null
      });
    }
    
    const { apptId } = req.params;
    const { user_id } = req.user; // 从JWT中间件获取用户ID
    
    // 查询预约详情
    const appointment = await Appointment.findOne({
      where: { apptId, userId: user_id, isValid: 1 },
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

// 查询可预约的排班列表（患者端）
exports.getAvailableSchedules = async (req, res) => {
  try {
    const { deptId, date, doctorId } = req.query;
    
    // 构建查询条件
    const whereClause = {
      auditStatus: 'approved',
      availableCount: { [Op.gt]: 0 } // 余号数大于0
    };
    
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
            { 
              model: Department 
            },
            { 
              model: User, 
              attributes: ['username'] 
            }
          ],
          // 通过科室ID过滤医生
          where: deptId ? { deptId: deptId } : {} 
        }
      ],
      order: [
        ['scheduleDate', 'ASC'],
        ['timeSlot', 'ASC']
      ]
    });
    
    // 格式化返回数据
    const formattedSchedules = schedules.map(schedule => {
      return {
        scheduleId: schedule.scheduleId,
        doctorId: schedule.Doctor.doctorId,
        doctorName: schedule.Doctor.User.username,
        doctorTitle: schedule.Doctor.title,
        departmentName: schedule.Doctor.Department.deptName,
        scheduleDate: schedule.scheduleDate,
        timeSlot: schedule.timeSlot,
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
}

// 签到验证接口
exports.verifySignIn = async (req, res) => {
  try {
    const { idCard, realName } = req.body;
    
    // 参数验证
    if (!idCard || !realName) {
      return res.status(400).json({
        code: 400,
        message: '身份证号码和姓名不能为空',
        data: null
      });
    }
    
    // 验证身份证号码格式（18位）
    const idCardRegex = /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/;
    if (!idCardRegex.test(idCard)) {
      return res.status(400).json({
        code: 400,
        message: '身份证号码格式不正确',
        data: null
      });
    }
    
    // 验证姓名格式（只允许中文）
    const realNameRegex = /^[\u4e00-\u9fa5]{2,6}$/;
    if (!realNameRegex.test(realName)) {
      return res.status(400).json({
        code: 400,
        message: '姓名格式不正确，只能包含2-6个中文字符',
        data: null
      });
    }
    
    // 查找用户信息（通过身份证和姓名）
    const userProfile = await UserProfile.findOne({
      where: {
        idCard: idCard,
        realName: realName
      },
      include: [{
        model: User,
        attributes: ['userId']
      }]
    });
    
    if (!userProfile) {
      return res.status(404).json({
        code: 404,
        message: '未找到匹配的用户信息',
        data: null
      });
    }
    
    const userId = userProfile.userId;
    
    // 获取当前日期（YYYY-MM-DD格式）
    const today = new Date().toISOString().split('T')[0];
    
    // 查找今天的未签到预约
    const appointment = await Appointment.findOne({
      where: {
        userId: userId,
        scheduleDate: today,
        status: ['pending', 'called'], // 只处理待就诊和已叫号的预约
        checkInStatus: 'not_checked' // 只处理未签到的预约
      },
      include: [{
        model: Schedule,
        include: [{
          model: Doctor,
          include: [{
            model: User,
            attributes: ['username']
          }]
        }]
      }]
    });
    
    if (!appointment) {
      return res.status(404).json({
        code: 404,
        message: '未找到今天的有效预约或已完成签到',
        data: null
      });
    }
    
    // 更新签到状态
    await appointment.update({
      checkInStatus: 'checked_in'
    });
    
    // 返回成功响应
    return res.status(200).json({
      code: 200,
      message: '签到成功',
      data: {
        apptId: appointment.apptId,
        serialNumber: appointment.serialNumber,
        doctorName: appointment.Schedule.Doctor.User.username,
        scheduleDate: appointment.scheduleDate,
        checkInStatus: appointment.checkInStatus
      }
    });
    
  } catch (error) {
    console.error('签到验证失败:', error);
    res.status(500).json({
      code: 500,
      message: '签到过程中发生错误',
      data: null
    });
  }
}