const cron = require('node-cron');
const { Schedule, WaitingList, Appointment, sequelize } = require('../models');
const { APPOINTMENT_STATUS } = require('../models/Appointment');
const { Op } = require('sequelize');

/**
 * 候补队列自动处理工具
 * 功能：
 * 1. 定期检查所有排班的余号数
 * 2. 当排班有余号且存在等待中的候补用户时，自动将候补用户转为正式预约
 */
class WaitingListProcessor {
  /**
   * 初始化候补队列自动处理
   */
  static init() {
    console.log('正在初始化候补队列自动处理...');
    
    // 每10秒执行一次候补队列处理任务（临时设置）
    // 格式：秒 分 时 日 月 周
    cron.schedule('*/10 * * * * *', async () => {
      console.log('开始执行候补队列自动处理任务...');
      await this.processWaitingLists();
    });
    
    console.log('候补队列自动处理已初始化，每10秒执行一次（临时设置）');
  }
  
  /**
   * 处理所有排班的候补队列
   */
  static async processWaitingLists() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 1. 先从候补表中查询所有等待中的记录，获取对应的scheduleId
      const waitingRecords = await WaitingList.findAll({
        where: {
          status: 'waiting'
        },
        attributes: ['scheduleId'],
        group: ['scheduleId'] // 按scheduleId分组，避免重复处理
      });
      
      if (waitingRecords.length === 0) {
        console.log('没有等待中的候补记录，无需处理');
        return;
      }
      
      // 提取所有有等待记录的排班ID
      const scheduleIds = waitingRecords.map(record => record.scheduleId);
      
      console.log(`找到 ${scheduleIds.length} 个排班有等待中的候补用户`);
      
      // 2. 查询这些排班中有余号且符合条件的排班
      const availableSchedules = await Schedule.findAll({
        where: {
          scheduleId: { [Op.in]: scheduleIds }, // 只查询有候补用户的排班
          scheduleDate: { [Op.gte]: today }, // 只处理今天及以后的排班
          availableCount: { [Op.gt]: 0 }, // 有余号
          allowWaiting: 1, // 开启了候补功能
          auditStatus: 'approved' // 已批准的排班
        },
        attributes: ['scheduleId', 'availableCount']
      });
      
      console.log(`其中 ${availableSchedules.length} 个排班有余号，需要处理候补队列`);
      
      // 3. 处理每个有余号的排班的候补队列
      const processedResults = await Promise.all(availableSchedules.map(async (schedule) => {
        const { scheduleId, availableCount } = schedule;
        
        // 查询该排班的详细信息，获取scheduleDate
      const scheduleDetails = await Schedule.findByPk(scheduleId, {
        attributes: ['scheduleDate']
      });
      
      // 处理该排班的候补队列
      return await this.processWaitingListForSchedule(scheduleId, availableCount, scheduleDetails.scheduleDate);
      }));
      
      // 统计结果
      const totalProcessed = processedResults.reduce((sum, count) => sum + count, 0);
      console.log(`候补队列自动处理任务完成，共转正 ${totalProcessed} 个候补用户`);
      
    } catch (error) {
      console.error('候补队列自动处理失败:', error);
    }
  }
  
  /**
   * 处理单个排班的候补队列
   * @param {number} scheduleId - 排班ID
   * @param {number} availableCount - 当前余号数
   * @param {Date} scheduleDate - 排班日期
   * @returns {number} - 成功处理的候补用户数量
   */
  static async processWaitingListForSchedule(scheduleId, availableCount, scheduleDate) {
    let processedCount = 0;
    
    try {
      // 开始事务
      const transaction = await sequelize.transaction();
      
      try {
        // 1. 查询该排班的等待中候补用户，按加入时间排序（先到先得）
        const waitingUsers = await WaitingList.findAll({
          where: {
            scheduleId: scheduleId,
            status: 'waiting'
          },
          order: [['waitingTime', 'ASC']], // 使用正确的字段名waitingTime
          limit: availableCount, // 最多处理availableCount个用户
          transaction
        });
        
        if (waitingUsers.length === 0) {
          await transaction.commit();
          return 0;
        }
        
        console.log(`排班 ${scheduleId} 有 ${waitingUsers.length} 个等待中的候补用户，将处理 ${Math.min(waitingUsers.length, availableCount)} 个`);
        
        // 2. 获取当前最大的序列号（使用原始SQL查询确保准确性）
        const [results] = await sequelize.query(
          'SELECT MAX(serial_number) as maxSerialNumber FROM tb_appointment WHERE schedule_id = ?',
          {
            replacements: [scheduleId],
            transaction
          }
        );
        
        let nextSerialNumber = (results[0]?.maxSerialNumber || 0) + 1;
        
        console.log(`排班 ${scheduleId} 的当前最大序列号为 ${results[0]?.maxSerialNumber || 0}，下一个序列号为 ${nextSerialNumber}`);
        
        // 3. 处理每个候补用户
        for (const waitingUser of waitingUsers) {
          // 创建新的预约记录
          const appointment = await Appointment.create({
            userId: waitingUser.userId,
            scheduleId: scheduleId,
            scheduleDate: scheduleDate, // 添加必填的排班日期
            serialNumber: nextSerialNumber++,
            status: APPOINTMENT_STATUS.PENDING,
            checkInStatus: 'not_checked',
            isValid: 1
          }, { transaction });
          
          // 更新候补状态为已确认
          await waitingUser.update({
            status: 'converted', // 使用模型中定义的正确状态值
            convertedAt: new Date(),
            convertedToApptId: appointment.apptId // 记录转成的预约ID
          }, { transaction });
          
          // 原子性减少余号数
          await Schedule.update(
            { availableCount: sequelize.literal('available_count - 1') },
            { 
              where: { scheduleId: scheduleId, availableCount: { [Op.gt]: 0 } },
              transaction 
            }
          );
          
          processedCount++;
        }
        
        await transaction.commit();
        console.log(`排班 ${scheduleId} 成功处理 ${processedCount} 个候补用户`);
        
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      
    } catch (error) {
      console.error(`处理排班 ${scheduleId} 的候补队列失败:`, error);
    }
    
    return processedCount;
  }
  
  /**
   * 手动触发候补队列处理（用于测试）
   */
  static async manuallyProcessWaitingLists() {
    console.log('手动触发候补队列自动处理...');
    await this.processWaitingLists();
  }
  
  /**
   * 手动触发特定排班的候补队列处理（用于测试）
   * @param {number} scheduleId - 排班ID
   */
  static async manuallyProcessScheduleWaitingList(scheduleId) {
    try {
      // 获取该排班的当前余号数
      const schedule = await Schedule.findOne({
        where: { scheduleId: scheduleId },
        attributes: ['availableCount']
      });
      
      if (!schedule) {
        console.log(`未找到排班 ${scheduleId}`);
        return 0;
      }
      
      console.log(`手动触发处理排班 ${scheduleId} 的候补队列...`);
      return await this.processWaitingListForSchedule(scheduleId, schedule.availableCount);
    } catch (error) {
      console.error(`手动处理排班 ${scheduleId} 的候补队列失败:`, error);
      return 0;
    }
  }
}

module.exports = WaitingListProcessor;