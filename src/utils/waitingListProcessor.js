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
    
    // 每30秒执行一次候补队列处理任务
    // 格式：秒 分 时 日 月 周
    cron.schedule('*/30 * * * * *', async () => {
      console.log('开始执行候补队列自动处理任务...');
      await this.processWaitingLists();
    });
    
    console.log('候补队列自动处理已初始化，每五秒执行一次');
  }
  
  /**
   * 处理所有排班的候补队列
   */
  static async processWaitingLists() {
    try {
      // 1. 获取本地日期和时间
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

      // 2. 找到所有有候补记录的排班ID
      const waitingRecords = await WaitingList.findAll({
        where: { status: 'waiting' },
        attributes: ['scheduleId'],
        group: ['scheduleId']
      });

      if (waitingRecords.length === 0) {
        console.log('没有等待中的候补记录，无需处理');
        return;
      }

      console.log(`找到 ${waitingRecords.length} 个排班有等待中的候补用户`);

      for (const record of waitingRecords) {
        const scheduleId = record.scheduleId;
        const schedule = await Schedule.findByPk(scheduleId);

        if (!schedule) continue;

        // --- 核心拦截：检查该排班是否已经过期 ---
        const startTime = schedule.timeSlot.split('-')[0];
        const isExpired = schedule.scheduleDate < today || (schedule.scheduleDate === today && currentTime >= startTime);

        if (isExpired) {
          // 如果已过期，批量将该排班的候补设为已过期，不再转正
          await WaitingList.update(
            { status: 'expired' },
            { where: { scheduleId, status: 'waiting' } }
          );
          console.log(`[候补清理] 排班 ${scheduleId} 已过期，所有候补记录已作废`);
          continue;
        }

        // --- 调试日志：检查转正条件 --- 
        console.log(`[转正条件检查] 排班 ${scheduleId}：`);
        console.log(`  - 余号数: ${schedule.availableCount}`);
        console.log(`  - 是否允许候补: ${schedule.allowWaiting}`);
        console.log(`  - 审核状态: ${schedule.auditStatus}`);
        
        // --- 如果未过期，且有余号，执行转正逻辑 ---
        if (schedule.availableCount > 0 && schedule.allowWaiting && schedule.auditStatus === 'approved') {
          console.log(`[转正执行] 排班 ${scheduleId} 满足转正条件，执行转正逻辑`);
          await this.processWaitingListForSchedule(scheduleId, schedule.availableCount, schedule.scheduleDate);
        } else {
          console.log(`[转正跳过] 排班 ${scheduleId} 不满足转正条件`);
          if (schedule.availableCount <= 0) {
            console.log(`    - 原因：余号数不足（余号：${schedule.availableCount}）`);
          }
          if (schedule.allowWaiting !== 1) {
            console.log(`    - 原因：不允许候补（allowWaiting：${schedule.allowWaiting}）`);
          }
          if (schedule.auditStatus !== 'approved') {
            console.log(`    - 原因：排班未通过审核（审核状态：${schedule.auditStatus}）`);
          }
        }
      }
      
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
        // 1. 获取排在前面的候补用户
        const waitingUsers = await WaitingList.findAll({
          where: { scheduleId, status: 'waiting' },
          order: [['waitingTime', 'ASC']], // 按加入时间排序，先到先得
          limit: availableCount,
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

        for (const waitingUser of waitingUsers) {
          // 1. 创建正式预约
          const appointment = await Appointment.create({
            userId: waitingUser.userId,
            scheduleId: scheduleId,
            scheduleDate: scheduleDate, // 添加必填的排班日期
            serialNumber: nextSerialNumber++,
            status: APPOINTMENT_STATUS.PENDING,
            checkInStatus: 'not_checked',
            isValid: 1
          }, { transaction });

          // 2. 更新候补状态
          await waitingUser.update({
            status: 'converted',
            convertedAt: new Date(),
            convertedToApptId: appointment.apptId // 记录转成的预约ID
          }, { transaction });

          // 3. 扣减余号
          await Schedule.decrement('availableCount', {
            where: { scheduleId },
            transaction
          });

          // [重要] 在此处可以调用微信订阅消息接口，通知用户：
          // "您好，您的候补申请已转正成功，请准时就诊。"
          
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