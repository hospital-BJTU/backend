const { sequelize } = require('./src/config/database');

// 修复tb_schedule表的schedule_id字段和audit_status字段
async function fixScheduleTable() {
  try {
    console.log('开始修复tb_schedule表...');
    
    // 1. 临时禁用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
    
    // 2. 修改schedule_id字段为AUTO_INCREMENT
    await sequelize.query(`
      ALTER TABLE tb_schedule 
      MODIFY COLUMN schedule_id INT AUTO_INCREMENT;
    `);
    console.log('schedule_id字段修复成功');
    
    // 3. 更新audit_status字段，添加leave_requested和cancelled枚举值
    await sequelize.query(`
      ALTER TABLE tb_schedule 
      MODIFY COLUMN audit_status ENUM('pending', 'approved', 'rejected', 'leave_requested', 'cancelled') NOT NULL DEFAULT 'pending';
    `);
    console.log('audit_status字段修复成功，已添加leave_requested和cancelled值');
    
    // 4. 重新启用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
    
    console.log('表结构修复完成！');
  } catch (error) {
    console.error('修复表结构时出错:', error.message);
  } finally {
    await sequelize.close();
  }
}

fixScheduleTable();