const redis = require('../config/redis');
const { Schedule, Op } = require('../models/index');

/**
 * 库存Redis管理器 - 用于管理医生号源库存的Redis缓存
 */
const inventoryRedisManager = {
  /**
   * 生成Redis库存键
   * @param {number} scheduleId - 排班ID
   * @returns {string} Redis键名
   */
  getInventoryKey: (scheduleId) => {
    return `inventory:schedule:${scheduleId}`;
  },

  /**
   * 从数据库加载所有有效排班的库存到Redis
   * @returns {Promise<number>} 加载的库存数量
   */
  loadAllInventoryToRedis: async () => {
    try {
      // 查询所有有效的排班（已审核通过且有库存的）
      const schedules = await Schedule.findAll({
        where: {
          auditStatus: 'approved',
          availableCount: { [Op.gt]: 0 }
        },
        attributes: ['scheduleId', 'availableCount']
      });

      // 批量加载到Redis
      const promises = schedules.map(async (schedule) => {
        const key = inventoryRedisManager.getInventoryKey(schedule.scheduleId);
        await redis.set(key, schedule.availableCount);
      });

      await Promise.all(promises);
      return schedules.length;
    } catch (error) {
      console.error('加载库存到Redis失败:', error);
      return 0;
    }
  },

  /**
   * 获取指定排班的库存
   * @param {number} scheduleId - 排班ID
   * @returns {Promise<number|null>} 库存数量，失败返回null
   */
  getInventory: async (scheduleId) => {
    try {
      const key = inventoryRedisManager.getInventoryKey(scheduleId);
      const inventory = await redis.get(key);
      return inventory ? parseInt(inventory) : null;
    } catch (error) {
      console.error(`获取排班${scheduleId}库存失败:`, error);
      return null;
    }
  },

  /**
   * 扣减指定排班的库存
   * @param {number} scheduleId - 排班ID
   * @returns {Promise<boolean>} 是否扣减成功
   */
  decrementInventory: async (scheduleId) => {
    try {
      const key = inventoryRedisManager.getInventoryKey(scheduleId);
      const newInventory = await redis.redisClient.decr(key);
      
      // 如果库存小于0，回滚并返回失败
      if (newInventory < 0) {
        await redis.redisClient.incr(key);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`扣减排班${scheduleId}库存失败:`, error);
      return false;
    }
  },

  /**
   * 增加指定排班的库存
   * @param {number} scheduleId - 排班ID
   * @returns {Promise<boolean>} 是否增加成功
   */
  incrementInventory: async (scheduleId) => {
    try {
      const key = inventoryRedisManager.getInventoryKey(scheduleId);
      await redis.redisClient.incr(key);
      return true;
    } catch (error) {
      console.error(`增加排班${scheduleId}库存失败:`, error);
      return false;
    }
  },

  /**
   * 更新指定排班的库存
   * @param {number} scheduleId - 排班ID
   * @param {number} availableCount - 新的库存数量
   * @returns {Promise<boolean>} 是否更新成功
   */
  updateInventory: async (scheduleId, availableCount) => {
    try {
      const key = inventoryRedisManager.getInventoryKey(scheduleId);
      await redis.set(key, availableCount);
      return true;
    } catch (error) {
      console.error(`更新排班${scheduleId}库存失败:`, error);
      return false;
    }
  },

  /**
   * 从Redis删除指定排班的库存
   * @param {number} scheduleId - 排班ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  removeInventory: async (scheduleId) => {
    try {
      const key = inventoryRedisManager.getInventoryKey(scheduleId);
      await redis.del(key);
      return true;
    } catch (error) {
      console.error(`删除排班${scheduleId}库存失败:`, error);
      return false;
    }
  }
};

module.exports = inventoryRedisManager;
