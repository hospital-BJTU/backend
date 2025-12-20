const cron = require('node-cron');
const { Appointment, sequelize } = require('../models');
const { APPOINTMENT_STATUS, CHECK_IN_STATUS } = require('../models/Appointment');
const { Op } = require('sequelize');

/**
 * 预约过期检测工具
 * 功能：
 * 1. 检测未签到的过期预约，标记为取消
 * 2. 检测已签到但未叫号的过期预约，标记为取消
 */
class AppointmentExpiryChecker {
  /**
   * 初始化过期检测
   */
  static init() {
    console.log('正在初始化预约过期检测...');
    
    // 每天凌晨1点执行过期检测任务
    // 格式：秒 分 时 日 月 周
    cron.schedule('0 0 1 * * *', async () => {
      console.log('开始执行预约过期检测任务...');
      await this.checkExpiredAppointments();
    });
    
    console.log('预约过期检测已初始化，每天凌晨1点执行');
  }
  
  /**
   * 检查过期预约
   */
  static async checkExpiredAppointments() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // 1. 查找所有过期的预约（预约日期小于今天）
      const expiredAppointments = await Appointment.findAll({
        where: {
          scheduleDate: { [Op.lt]: today },
          status: { 
            [Op.not]: [
              APPOINTMENT_STATUS.COMPLETED,
              APPOINTMENT_STATUS.CANCELLED
            ]
          }
        }
      });
      
      console.log(`找到 ${expiredAppointments.length} 个过期预约需要处理`);
      
      // 2. 处理每个过期预约
      const processedCount = await Promise.all(expiredAppointments.map(async (appointment) => {
        // 未签到的预约直接取消
        if (appointment.checkInStatus === CHECK_IN_STATUS.NOT_CHECKED) {
          await appointment.update({
            status: APPOINTMENT_STATUS.CANCELLED,
            checkInStatus: CHECK_IN_STATUS.NOT_CHECKED
          });
          console.log(`预约 ${appointment.apptId} 因未签到已被取消`);
          return 1;
        }
        
        // 已签到但未叫号或未完成的预约也取消
        if (appointment.checkInStatus === CHECK_IN_STATUS.CHECKED_IN && 
            appointment.status !== APPOINTMENT_STATUS.COMPLETED) {
          await appointment.update({
            status: APPOINTMENT_STATUS.CANCELLED
          });
          console.log(`预约 ${appointment.apptId} 已签到但未完成诊疗，已被取消`);
          return 1;
        }
        
        return 0;
      }));
      
      const totalProcessed = processedCount.reduce((sum, count) => sum + count, 0);
      console.log(`预约过期检测任务完成，共处理 ${totalProcessed} 个预约`);
      
    } catch (error) {
      console.error('预约过期检测失败:', error);
    }
  }
  
  /**
   * 手动触发过期检测（用于测试）
   */
  static async manuallyCheckExpiredAppointments() {
    console.log('手动触发预约过期检测...');
    await this.checkExpiredAppointments();
  }
}

module.exports = AppointmentExpiryChecker;