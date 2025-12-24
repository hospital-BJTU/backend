const cron = require('node-cron');
const { Schedule } = require('../models');
const { Op } = require('sequelize');

/**
 * 排班过期检测工具
 * 功能：每小时检查一次已过期的排班，将其设置为不可预约状态（余号为0且不可候补）
 */
class ScheduleExpiryChecker {
  /**
   * 初始化排班过期检测
   */
  static async init() {
    console.log('正在初始化排班过期检测...');
    
    // 服务器启动时立即执行一次检测
    console.log('服务器启动，立即执行排班过期检测...');
    await this.checkExpiredSchedules();
    
    // 每5分钟执行一次排班过期检测任务
    // 格式：秒 分 时 日 月 周
    cron.schedule('0 */5 * * * *', async () => {
      console.log('开始执行排班过期检测任务...');
      await this.checkExpiredSchedules();
    });
    
    console.log('排班过期检测已初始化，服务器启动时执行一次，之后每小时执行一次');
  }
  
  /**
   * 检查过期排班
   */
  static async checkExpiredSchedules() {
    try {
      const now = new Date();
      // 手动拼接本地日期 YYYY-MM-DD
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM
      
      console.log(`当前时间：${today} ${currentTime}`);
      
      // 1. 查找所有今天的排班，且结束时间已过
      const expiredSchedules = await Schedule.findAll({
        where: {
          // 排班日期等于今天
          scheduleDate: today,
          // 审核状态已通过
          auditStatus: 'approved',
          // 余号大于0 或 允许候补
          [Op.or]: [
            { availableCount: { [Op.gt]: 0 } },
            { allowWaiting: true }
          ]
        }
      });
      
      console.log(`找到 ${expiredSchedules.length} 个今天的排班，开始检查是否过期`);
      
      let processedCount = 0;
      
      // 2. 逐个检查并处理过期排班
      for (const schedule of expiredSchedules) {
        const timeSlot = schedule.timeSlot;
        const startTime = timeSlot.split('-')[0]; // 从 "09:00-10:00" 中提取开始时间 "09:00"
        
        // 比较时间：如果当前时间已经超过排班开始时间，则认为该排班已过期
        if (currentTime >= startTime) {
          // 将过期排班设置为不可预约状态：余号为0且不可候补
          await schedule.update({
            availableCount: 0,
            allowWaiting: false
          });
          
          console.log(`排班 ${schedule.scheduleId} (日期: ${schedule.scheduleDate}, 时间: ${schedule.timeSlot}) 已过期，已设置为不可预约状态`);
          processedCount++;
        }
      }
      
      console.log(`排班过期检测任务完成，共处理 ${processedCount} 个过期排班`);
      
    } catch (error) {
      console.error('排班过期检测失败:', error);
    }
  }
  
  /**
   * 手动触发排班过期检测（用于测试）
   */
  static async manuallyCheckExpiredSchedules() {
    console.log('手动触发排班过期检测...');
    await this.checkExpiredSchedules();
  }
}

module.exports = ScheduleExpiryChecker;