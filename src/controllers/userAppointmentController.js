const { Appointment, Schedule, Doctor, Department, User, UserProfile, WaitingList } = require('../models');
const { Op } = require('sequelize');
const AntiHoardingLogModel = require('../models/AntiHoardingLog');
const AntiHoardingLog = AntiHoardingLogModel.getModel();

// 获取北京时间本地日期 (YYYY-MM-DD)
const getLocalToday = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

// 处理排班余号增加时的候补转正逻辑
exports.processWaitingListForSchedule = async function processWaitingListForSchedule(scheduleId, transaction = null) {
  try {
    // 检查是否有等待中的候补用户
    const nextWaiting = await WaitingList.findOne({
      where: {
        scheduleId,
        status: 'waiting'
      },
      order: [['waitingNumber', 'ASC']],
      transaction
    });
    
    if (nextWaiting) {
      // 获取排班信息以确保有可用余号
      const schedule = await Schedule.findOne({
        where: { scheduleId },
        attributes: ['availableCount'],
        transaction
      });
      
      if (schedule && schedule.availableCount > 0) {
        // 更新候补状态为已确认
        await nextWaiting.update({
          status: 'confirmed'
        }, { transaction });
        
        // 为候补用户创建新的预约记录
        // 获取当前最大序列号
        const maxSerialNumber = await Appointment.max('serialNumber', {
          where: { scheduleId },
          transaction
        });
        
        const newSerialNumber = maxSerialNumber ? maxSerialNumber + 1 : 1;
        
        // 创建新预约
        await Appointment.create({
          userId: nextWaiting.userId,
          doctorId: nextWaiting.doctorId,
          scheduleId,
          serialNumber: newSerialNumber,
          status: 'pending',
          isValid: 1
        }, { transaction });
        
        // 减少排班余号数（使用原子更新SQL避免并发更新丢失问题）
        await Schedule.sequelize.query(
          'UPDATE tb_schedule SET available_count = available_count - 1 WHERE schedule_id = :scheduleId',
          {
            replacements: { scheduleId },
            transaction,
            type: Schedule.sequelize.QueryTypes.UPDATE
          }
        );
        
        console.log(`已将候补用户 ${nextWaiting.userId} 的预约转正，排班ID: ${scheduleId}`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`处理排班${scheduleId}的候补队列失败:`, error);
    return false;
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
      // 如果预约状态为已取消，返回特殊提示
      if (existingAppointment.status === 'cancelled') {
        return res.status(400).json({
          code: 400,
          message: '您已经取消过这个预约，不能再次预约',
          data: null
        });
      } else {
        // 其他状态的预约，返回通用提示
        return res.status(400).json({
          code: 400,
          message: '您已经在该排班下有预约记录，请不要重复预约',
          data: null
        });
      }
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
      
      // 实时时间比对 - 检查是否可以预约
      const today = getLocalToday();
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      
      // 强制转换日期格式对比
      const scheduleDateStr = schedule.scheduleDate instanceof Date 
        ? `${schedule.scheduleDate.getFullYear()}-${String(schedule.scheduleDate.getMonth() + 1).padStart(2, '0')}-${String(schedule.scheduleDate.getDate()).padStart(2, '0')}`
        : schedule.scheduleDate;
      
      // 1. 拦截过期日期
      if (scheduleDateStr < today) {
        if (transaction) await transaction.rollback();
        return res.status(400).json({ code: 400, message: '不能预约过去日期的号源' });
      }
      
      // 2. 核心拦截：如果是今天，必须检查当前时间是否已过开始时间
      if (scheduleDateStr === today) {
        const startTime = schedule.timeSlot.split('-')[0]; // 从 "09:00-10:00" 提取 "09:00"
        if (currentTime >= startTime) {
          if (transaction) await transaction.rollback();
          return res.status(400).json({ 
            code: 400, 
            message: `该时段(${schedule.timeSlot})预约已截止，请预约其他时段` 
          });
        }
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

// 加入候补队列
exports.joinWaitingList = async (req, res) => {
  try {
    console.log('=== 加入候补队列方法开始 ===');
    console.log('请求体:', JSON.stringify(req.body));
    console.log('用户信息:', JSON.stringify(req.user));
    
    // 用户登录状态检查
    if (!req.user || (!req.user.user_id && !req.user.userId)) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const { scheduleId } = req.body;
    const userId = req.user.user_id || req.user.userId;
    
    // 参数验证
    if (!scheduleId || !userId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数',
        data: null
      });
    }
    
    // 检查排班是否存在且已审核
    const schedule = await Schedule.findOne({
      where: {
        scheduleId: scheduleId,
        auditStatus: 'approved'
      }
    });
    
    if (!schedule) {
      return res.status(404).json({
        code: 404,
        message: '排班不存在或未通过审核',
        data: null
      });
    }
    
    // 时间比对 - 检查是否可以加入候补
    const today = getLocalToday();
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"
    
    // 将scheduleDate转换为字符串格式以确保准确比较
    const scheduleDateStr = schedule.scheduleDate instanceof Date 
      ? schedule.scheduleDate.toISOString().split('T')[0] 
      : schedule.scheduleDate;
    
    // 1. 拦截日期
    if (scheduleDateStr < today) {
      return res.status(400).json({ code: 400, message: '预约日期已过期' });
    }
    
    // 2. 拦截当天已过时的时段
    if (scheduleDateStr === today) {
      const startTime = schedule.timeSlot.split('-')[0];
      if (currentTime >= startTime) {
        return res.status(400).json({ code: 400, message: '该时段已过，无法加入候补，请选择其他时段' });
      }
    }

    // 1. 检查目标号源是否已满
    if (schedule.availableCount > 0) {
      return res.status(400).json({
        code: 400,
        message: '当前号源充足，无需加入候补',
        data: null
      });
    }

    // 2. 验证科室/医生是否开通候补功能
    const doctor = await Doctor.findByPk(schedule.doctorId);
    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在',
        data: null
      });
    }

    const department = await Department.findByPk(doctor.deptId);
    if (!department) {
      return res.status(404).json({
        code: 404,
        message: '科室不存在',
        data: null
      });
    }

    // 检查排班是否开放候补功能
    if (!schedule.allowWaiting) {
      return res.status(400).json({ 
        code: 400,
        message: '该排班未开放候补功能',
        data: null
      });
    }
    
    // 检查候补队列是否已满
    const currentWaitingCount = await WaitingList.count({
      where: {
        scheduleId: scheduleId,
        status: 'waiting'
      }
    });
    
    // 获取候补名额限制，默认为2
      const waitingLimit = schedule.waitingListLimit || 2;
    
    if (currentWaitingCount >= waitingLimit) {
      return res.status(400).json({ 
        code: 400,
        message: `该排班的候补队列已满，候补失败`,
        data: null
      });
    }

    // 3. 检查患者条件
    // 3.1 检查是否实名认证（身份是否核验）
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        code: 404,
        message: '用户不存在',
        data: null
      });
    }

    if (user.verifyStatus !== 'verified') {
      return res.status(400).json({
        code: 400,
        message: '您尚未完成实名认证，无法加入候补',
        data: null
      });
    }

    // 3.2 检查同一科室候补申请限制（一个患者同一科室只能有一个候补）
    const sameDeptWaitingCount = await WaitingList.count({
      where: {
        userId,
        status: 'waiting'
      },
      include: [
        {
          model: Schedule,
          attributes: [],
          where: {
            doctorId: {
              [Op.in]: (await Doctor.findAll({
                where: { deptId: doctor.deptId },
                attributes: ['doctorId']
              })).map(d => d.doctorId)
            },
            auditStatus: 'approved'
          }
        }
      ]
    });

    // 设置同一科室候补申请数量限制为1个
    const MAX_WAITING_PER_DEPT = 1;
    if (sameDeptWaitingCount >= MAX_WAITING_PER_DEPT) {
      return res.status(400).json({
        code: 400,
        message: '同一科室最多只能申请1个候补号源',
        data: null
      });
    }
    
    // 检查用户是否已经在该排班的候补列表中（任何状态）
    const existingWaiting = await WaitingList.findOne({
      where: {
        userId: userId,
        scheduleId: scheduleId
      }
    });
    
    if (existingWaiting) {
      // 根据不同状态返回不同的提示信息
      if (existingWaiting.status === 'waiting') {
        return res.status(400).json({
          code: 400,
          message: '您已经在该排班的候补列表中',
          data: {
            waitingId: existingWaiting.waitingId,
            waitingNumber: existingWaiting.waitingNumber
          }
        });
      } else {
        // 如果是其他状态（已取消、已过期、已转正），提示用户可以重新加入
        // 先删除旧记录
        await existingWaiting.destroy();
        console.log('已删除用户在该排班的旧候补记录，准备创建新记录');
      }
    }
    
    // 检查用户是否已经在该排班有有效预约
    const existingAppointment = await Appointment.findOne({
      where: {
        userId: userId,
        scheduleId: scheduleId,
        isValid: 1,
        status: { [Op.in]: ['pending', 'called', 'completed'] }
      }
    });
    
    if (existingAppointment) {
      return res.status(400).json({
        code: 400,
        message: '您已经在该排班有有效预约，无法加入候补',
        data: {
          appointmentId: existingAppointment.apptId
        }
      });
    }
    
    // 计算新的候补顺序号
    const maxWaitingNumber = await WaitingList.max('waitingNumber', {
      where: {
        scheduleId: scheduleId
      }
    });
    const newWaitingNumber = maxWaitingNumber ? maxWaitingNumber + 1 : 1;
    
    // 创建候补记录
    const waitingRecord = await WaitingList.create({
      userId: userId,
      scheduleId: scheduleId,
      waitingNumber: newWaitingNumber,
      status: 'waiting',
      waitingTime: new Date()
    });
    
    console.log('候补记录创建成功:', waitingRecord);
    
    return res.status(201).json({
      code: 201,
      message: '成功加入候补队列',
      data: {
        waitingId: waitingRecord.waitingId,
        scheduleId: waitingRecord.scheduleId,
        waitingNumber: waitingRecord.waitingNumber,
        waitingTime: waitingRecord.waitingTime,
        status: waitingRecord.status
      }
    });
    
  } catch (error) {
    console.error('加入候补队列失败:', error);
    res.status(500).json({
      code: 500,
      message: '加入候补队列过程中发生错误',
      data: null
    });
  }
};

// 查询用户的候补列表
exports.getUserWaitingList = async (req, res) => {
  try {
    // 用户登录状态检查
    if (!req.user || (!req.user.user_id && !req.user.userId)) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const userId = req.user.user_id || req.user.userId;
    
    // 查询用户的所有候补记录
    const waitingList = await WaitingList.findAll({
      where: {
        userId: userId
      },
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
        },
        {
          model: Appointment,
          as: 'ConvertedAppointment',
          required: false
        }
      ],
      order: [['waitingTime', 'DESC']]
    });
    
    // 格式化返回数据
    const formattedWaitingList = waitingList.map((waiting) => {
      return {
        waitingId: waiting.waitingId,
        scheduleId: waiting.scheduleId,
        waitingNumber: waiting.waitingNumber,
        status: waiting.status,
        statusDescription: {
          waiting: '等待中',
          converted: '已转正',
          cancelled: '已取消',
          expired: '已过期'
        }[waiting.status],
        waitingTime: waiting.waitingTime,
        convertedAt: waiting.convertedAt,
        convertedToAppointment: waiting.ConvertedAppointment ? {
          appointmentId: waiting.ConvertedAppointment.apptId,
          serialNumber: waiting.ConvertedAppointment.serialNumber
        } : null,
        doctorName: waiting.Schedule.Doctor.User.username,
        doctorTitle: waiting.Schedule.Doctor.title,
        departmentName: waiting.Schedule.Doctor.Department.deptName,
        scheduleDate: waiting.Schedule.scheduleDate,
        timeSlot: waiting.Schedule.timeSlot
      };
    });
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        waitingList: formattedWaitingList,
        total: formattedWaitingList.length
      }
    });
    
  } catch (error) {
    console.error('查询用户候补列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};

// 查询候补详情
exports.getWaitingDetail = async (req, res) => {
  try {
    // 用户登录状态检查
    if (!req.user || (!req.user.user_id && !req.user.userId)) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const { waitingId } = req.params;
    const userId = req.user.user_id || req.user.userId;
    
    // 查询候补记录
    const waiting = await WaitingList.findOne({
      where: {
        waitingId: waitingId,
        userId: userId
      },
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
        },
        {
          model: Appointment,
          as: 'ConvertedAppointment',
          required: false
        }
      ]
    });
    
    if (!waiting) {
      return res.status(404).json({
        code: 404,
        message: '候补记录不存在或不属于当前用户',
        data: null
      });
    }
    
    // 计算前面还有多少人在等待
    const peopleAhead = await WaitingList.count({
      where: {
        scheduleId: waiting.scheduleId,
        status: 'waiting',
        waitingNumber: { [Op.lt]: waiting.waitingNumber }
      }
    });
    
    // 格式化返回数据
    const formattedWaiting = {
      waitingId: waiting.waitingId,
      scheduleId: waiting.scheduleId,
      waitingNumber: waiting.waitingNumber,
      status: waiting.status,
      statusDescription: {
        waiting: '等待中',
        converted: '已转正',
        cancelled: '已取消',
        expired: '已过期'
      }[waiting.status],
      waitingTime: waiting.waitingTime,
      convertedAt: waiting.convertedAt,
      convertedToAppointment: waiting.ConvertedAppointment ? {
        appointmentId: waiting.ConvertedAppointment.apptId,
        serialNumber: waiting.ConvertedAppointment.serialNumber
      } : null,
      doctorName: waiting.Schedule.Doctor.User.username,
      doctorTitle: waiting.Schedule.Doctor.title,
      departmentName: waiting.Schedule.Doctor.Department.deptName,
      scheduleDate: waiting.Schedule.scheduleDate,
      timeSlot: waiting.Schedule.timeSlot,
      peopleAhead: peopleAhead
    };
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: formattedWaiting
    });
    
  } catch (error) {
    console.error('查询候补详情失败:', error);
    res.status(500).json({
      code: 500,
      message: '查询过程中发生错误',
      data: null
    });
  }
};

// 取消候补
exports.cancelWaiting = async (req, res) => {
  try {
    // 用户登录状态检查
    if (!req.user || (!req.user.user_id && !req.user.userId)) {
      return res.status(401).json({
        code: 401,
        message: '用户未登录或登录状态已过期',
        data: null
      });
    }
    
    const { waitingId } = req.params;
    const userId = req.user.user_id || req.user.userId;
    
    // 查询候补记录
    const waiting = await WaitingList.findOne({
      where: {
        waitingId: waitingId,
        userId: userId
      }
    });
    
    if (!waiting) {
      return res.status(404).json({
        code: 404,
        message: '候补记录不存在或不属于当前用户',
        data: null
      });
    }
    
    // 检查候补状态
    if (waiting.status !== 'waiting') {
      return res.status(400).json({
        code: 400,
        message: `该候补记录当前状态为"${{
          waiting: '等待中',
          converted: '已转正',
          cancelled: '已取消',
          expired: '已过期'
        }[waiting.status]}"，无法取消`,
        data: {
          status: waiting.status
        }
      });
    }
    
    // 更新候补状态为已取消
    await waiting.update({
      status: 'cancelled'
    });
    
    return res.status(200).json({
      code: 200,
      message: '取消候补成功',
      data: {
        waitingId: waiting.waitingId,
        status: 'cancelled'
      }
    });
    
  } catch (error) {
    console.error('取消候补失败:', error);
    res.status(500).json({
      code: 500,
      message: '取消候补过程中发生错误',
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
      
      // 处理候补队列转正（使用新的通用函数）
      // 持续处理候补队列，直到没有可用余号或没有候补用户
      let hasProcessed = true;
      while (hasProcessed) {
        hasProcessed = await exports.processWaitingListForSchedule(appointment.scheduleId, transaction);
      }
      
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

// 查询可候补的排班列表（患者端）
exports.getAvailableWaitingSchedules = async (req, res) => {
  try {
    const { deptId, date, doctorId } = req.query;
    
    // 构建查询条件
    const whereClause = {
      auditStatus: 'approved'
    };
    
    if (date) {
      whereClause.scheduleDate = date;
    }
    
    if (doctorId) {
      whereClause.doctorId = doctorId;
    }
    
    // 查询排班，包括余号为0的排班（可以候补）
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
    
    // 格式化返回数据，包含当前候补人数
    const formattedSchedules = await Promise.all(schedules.map(async (schedule) => {
      // 计算当前候补人数
      const waitingCount = await WaitingList.count({
        where: {
          scheduleId: schedule.scheduleId,
          status: 'waiting'
        }
      });
      
      return {
        scheduleId: schedule.scheduleId,
        doctorId: schedule.Doctor.doctorId,
        doctorName: schedule.Doctor.User.username,
        doctorTitle: schedule.Doctor.title,
        departmentName: schedule.Doctor.Department.deptName,
        scheduleDate: schedule.scheduleDate,
        timeSlot: schedule.timeSlot,
        availableCount: schedule.availableCount,
        maxCount: schedule.maxCount,
        waitingCount: waitingCount,
        waitingListLimit: schedule.waitingListLimit || 2, // 显示候补名额限制，默认为2
        canAppoint: schedule.availableCount > 0,
        canWait: true // 所有已审核的排班都可以候补
      };
    }));
    
    return res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        schedules: formattedSchedules,
        total: formattedSchedules.length
      }
    });
    
  } catch (error) {
    console.error('查询可候补排班失败:', error);
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
      // 余号数大于0 或者 余号数为0但允许候补
      [Op.or]: [
        { availableCount: { [Op.gt]: 0 } },
        { availableCount: 0, allowWaiting: true }
      ]
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
    
    // 获取当前日期（YYYY-MM-DD格式）- 使用统一的getLocalToday函数
    const today = getLocalToday();
    
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
    
    // 增加时间窗口限制：只允许在预约时段开始前30分钟内签到
    const startTimeStr = appointment.Schedule.timeSlot.split('-')[0];
    const [startHour, startMinute] = startTimeStr.split(':').map(Number);
    
    // 创建预约开始时间的Date对象
    const startTime = new Date(now);
    startTime.setHours(startHour, startMinute, 0, 0);
    
    // 创建允许签到的开始时间（预约开始前30分钟）
    const checkInStartTime = new Date(startTime);
    checkInStartTime.setMinutes(checkInStartTime.getMinutes() - 30);
    
    // 创建允许签到的结束时间（预约开始后60分钟）
    const checkInEndTime = new Date(startTime);
    checkInEndTime.setMinutes(checkInEndTime.getMinutes() + 60);
    
    // 检查当前时间是否在允许签到的时间窗口内
    if (now < checkInStartTime || now > checkInEndTime) {
      return res.status(400).json({
        code: 400,
        message: `签到时间窗口为预约开始前30分钟至开始后60分钟内（当前预约时间段：${appointment.Schedule.timeSlot}）`,
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