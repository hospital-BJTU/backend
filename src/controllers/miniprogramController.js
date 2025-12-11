const { Appointment, Schedule, Doctor, Department, User } = require('../models');
const { Op } = require('sequelize');

// 小程序接口：获取所有科室列表
exports.getAllDepartments = async (req, res) => {
  try {
    const departments = await Department.findAll({
      attributes: ['deptId', 'deptName'],
      order: [['deptName', 'ASC']]
    });

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: departments
    });
  } catch (error) {
    console.error('获取科室列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取科室列表失败',
      data: { error: error.message }
    });
  }
};

// 小程序接口：根据科室ID获取医生列表
exports.getDoctorsByDepartment = async (req, res) => {
  try {
    const { deptId } = req.query;
    
    if (!deptId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：deptId',
        data: null
      });
    }

    console.log(`查询科室 ${deptId} 的医生列表`);

    const doctors = await Doctor.findAll({
      where: { 
        deptId: deptId
      },
      include: [
        {
          model: User,
          attributes: ['userId', 'username'],
          where: {
            verifyStatus: 'verified' // 只返回已审核通过的医生
          },
          required: true
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName']
        }
      ],
      attributes: ['doctorId', 'userId', 'deptId', 'title']
    });

    console.log(`找到 ${doctors.length} 名已审核的医生`);

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: doctors
    });
  } catch (error) {
    console.error('获取科室医生列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取科室医生列表失败',
      data: { error: error.message }
    });
  }
};

// 小程序接口：获取医生在指定日期范围内的排班信息
exports.getDoctorSchedules = async (req, res) => {
  try {
    const { doctorId, startDate, endDate } = req.query;
    
    if (!doctorId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：doctorId',
        data: null
      });
    }

    // 默认查询未来7天的排班
    const defaultStartDate = new Date().toISOString().split('T')[0];
    const defaultEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const queryStartDate = startDate || defaultStartDate;
    const queryEndDate = endDate || defaultEndDate;

    const schedules = await Schedule.findAll({
      where: {
        doctorId: doctorId,
        scheduleDate: {
          [Op.between]: [queryStartDate, queryEndDate]
        },
        auditStatus: 'approved' // 只返回已审核通过的排班
      },
      include: [
        {
          model: Doctor,
          attributes: ['doctorId', 'title'],
          include: [
            {
              model: Department,
              attributes: ['deptId', 'deptName']
            },
            {
              model: User,
              attributes: ['userId', 'username']
            }
          ]
        }
      ],
      order: [['scheduleDate', 'ASC'], ['timeSlot', 'ASC']]
    });

    // 为每个排班计算可用号源
    const schedulesWithAvailability = await Promise.all(
      schedules.map(async (schedule) => {
        // 统计已预约数量
        const appointmentCount = await Appointment.count({
          where: {
            scheduleId: schedule.scheduleId,
            isValid: 1,
            status: { [Op.in]: ['pending', 'called'] }
          }
        });

        return {
          scheduleId: schedule.scheduleId,
          scheduleDate: schedule.scheduleDate,
          timeSlot: schedule.timeSlot,
          maxCount: schedule.maxCount,
          availableCount: schedule.maxCount - appointmentCount,
          doctor: {
            doctorId: schedule.Doctor.doctorId,
            name: schedule.Doctor.User.username,
            title: schedule.Doctor.title,
            department: {
              deptId: schedule.Doctor.Department.deptId,
              deptName: schedule.Doctor.Department.deptName
            }
          }
        };
      })
    );

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: schedulesWithAvailability
    });
  } catch (error) {
    console.error('获取医生排班信息失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取医生排班信息失败',
      data: { error: error.message }
    });
  }
};

// 小程序接口：获取指定日期的号源信息
exports.getAvailableSlotsByDate = async (req, res) => {
  try {
    const { date, deptId } = req.query;
    
    if (!date) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：date',
        data: null
      });
    }

    // 构建查询条件
    const whereCondition = {
      scheduleDate: date,
      auditStatus: 'approved'
    };
    
    if (deptId) {
      whereCondition['$Doctor.deptId$'] = deptId;
    }

    const schedules = await Schedule.findAll({
      where: whereCondition,
      include: [
        {
          model: Doctor,
          include: [
            {
              model: Department,
              attributes: ['deptId', 'deptName']
            },
            {
              model: User,
              attributes: ['userId', 'username'],
              where: {
                verifyStatus: 'verified' // 只返回已审核通过的医生
              },
              required: true
            }
          ]
        }
      ],
      order: [['Doctor.Department.deptName', 'ASC'], ['Doctor.User.username', 'ASC'], ['timeSlot', 'ASC']]
    });

    // 为每个排班计算可用号源
    const availableSlots = await Promise.all(
      schedules.map(async (schedule) => {
        // 统计已预约数量
        const appointmentCount = await Appointment.count({
          where: {
            scheduleId: schedule.scheduleId,
            isValid: 1,
            status: { [Op.in]: ['pending', 'called'] }
          }
        });

        const availableCount = schedule.maxCount - appointmentCount;
        
        // 只返回有号源的排班
        if (availableCount <= 0) {
          return null;
        }

        return {
          scheduleId: schedule.scheduleId,
          scheduleDate: schedule.scheduleDate,
          timeSlot: schedule.timeSlot,
          maxCount: schedule.maxCount,
          availableCount: availableCount,
          doctor: {
            doctorId: schedule.Doctor.doctorId,
            name: schedule.Doctor.User.username,
            title: schedule.Doctor.title,
            department: {
              deptId: schedule.Doctor.Department.deptId,
              deptName: schedule.Doctor.Department.deptName
            }
          }
        };
      })
    );

    // 过滤掉null值
    const filteredSlots = availableSlots.filter(slot => slot !== null);

    // 按科室分组
    const groupedSlots = {};
    filteredSlots.forEach(slot => {
      const deptId = slot.doctor.department.deptId;
      const deptName = slot.doctor.department.deptName;
      
      if (!groupedSlots[deptId]) {
        groupedSlots[deptId] = {
          deptId,
          deptName,
          doctors: []
        };
      }
      
      const doctorIndex = groupedSlots[deptId].doctors.findIndex(
        d => d.doctorId === slot.doctor.doctorId
      );
      
      if (doctorIndex === -1) {
        groupedSlots[deptId].doctors.push({
          doctorId: slot.doctor.doctorId,
          name: slot.doctor.name,
          title: slot.doctor.title,
          slots: [slot]
        });
      } else {
        groupedSlots[deptId].doctors[doctorIndex].slots.push(slot);
      }
    });

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        date,
        departments: Object.values(groupedSlots)
      }
    });
  } catch (error) {
    console.error('获取可用号源失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取可用号源失败',
      data: { error: error.message }
    });
  }
};

// 小程序接口：获取医生详情
exports.getDoctorDetail = async (req, res) => {
  try {
    const { doctorId } = req.query;
    
    if (!doctorId) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：doctorId',
        data: null
      });
    }
    
    console.log(`查询医生详情，ID: ${doctorId}`);

    // 首先检查医生是否存在，不限制审核状态
    const doctorExists = await Doctor.findOne({
      where: { doctorId }
    });
    
    if (!doctorExists) {
      console.log(`医生ID ${doctorId} 不存在`);
      return res.status(404).json({
        code: 404,
        message: `医生ID ${doctorId} 不存在`,
        data: null
      });
    }
    
    console.log(`医生存在，userId: ${doctorExists.userId}`);

    // 检查用户的审核状态
    const userStatus = await User.findOne({
      where: { userId: doctorExists.userId },
      attributes: ['userId', 'username', 'verifyStatus']
    });
    
    if (!userStatus) {
      console.log(`医生ID ${doctorId} 对应的用户不存在`);
      return res.status(404).json({
        code: 404,
        message: '医生对应的用户信息不存在',
        data: null
      });
    }
    
    console.log(`用户审核状态: ${userStatus.verifyStatus}`);
    
    if (userStatus.verifyStatus !== 'verified') {
      return res.status(404).json({
        code: 404,
        message: `医生${userStatus.username}未通过审核，当前状态: ${userStatus.verifyStatus}`,
        data: null
      });
    }

    // 获取完整的医生详情
    const doctor = await Doctor.findOne({
      where: { doctorId },
      include: [
        {
          model: User,
          attributes: ['userId', 'username'],
          where: {
            verifyStatus: 'verified' // 只返回已审核通过的医生
          },
          required: true
        },
        {
          model: Department,
          attributes: ['deptId', 'deptName']
        }
      ],
      attributes: ['doctorId', 'userId', 'deptId', 'title']
    });

    if (!doctor) {
      return res.status(404).json({
        code: 404,
        message: '医生不存在或未审核通过',
        data: null
      });
    }

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: doctor
    });
  } catch (error) {
    console.error('获取医生详情失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取医生详情失败',
      data: { error: error.message }
    });
  }
};

// 小程序接口：获取指定日期的排班医生列表
exports.getDoctorsByDate = async (req, res) => {
  try {
    const { date, deptId } = req.query;
    
    if (!date) {
      return res.status(400).json({
        code: 400,
        message: '缺少必要参数：date',
        data: null
      });
    }

    // 构建查询条件
    const whereCondition = {
      scheduleDate: date,
      auditStatus: 'approved'
    };
    
    const doctorWhereCondition = {};
    if (deptId) {
      doctorWhereCondition.deptId = deptId;
    }

    const schedules = await Schedule.findAll({
      where: whereCondition,
      include: [
        {
          model: Doctor,
          where: doctorWhereCondition,
          include: [
            {
              model: Department,
              attributes: ['deptId', 'deptName']
            },
            {
              model: User,
              attributes: ['userId', 'username'],
              where: {
                verifyStatus: 'verified' // 只返回已审核通过的医生
              },
              required: true
            }
          ]
        }
      ],
      order: [['Doctor.Department.deptName', 'ASC'], ['Doctor.User.username', 'ASC']]
    });

    // 去重，获取唯一的医生列表
    const uniqueDoctors = [];
    const doctorIdMap = new Map();
    
    schedules.forEach(schedule => {
      const doctor = schedule.Doctor;
      if (!doctorIdMap.has(doctor.doctorId)) {
        doctorIdMap.set(doctor.doctorId, true);
        uniqueDoctors.push({
          doctorId: doctor.doctorId,
          name: doctor.User.username,
          title: doctor.title,
          department: {
            deptId: doctor.Department.deptId,
            deptName: doctor.Department.deptName
          }
        });
      }
    });

    res.status(200).json({
      code: 200,
      message: '查询成功',
      data: {
        date,
        doctors: uniqueDoctors
      }
    });
  } catch (error) {
    console.error('获取指定日期的医生列表失败:', error);
    res.status(500).json({
      code: 500,
      message: '获取指定日期的医生列表失败',
      data: { error: error.message }
    });
  }
};