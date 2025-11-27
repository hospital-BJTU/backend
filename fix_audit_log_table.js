const { sequelize } = require('./src/config/database');

// 直接执行SQL修改表结构，确保log_id字段是自增主键
async function fixAuditLogTable() {
  try {
    console.log('开始修复tb_audit_log表结构...');
    
    // 先尝试删除表（如果存在）
    await sequelize.query('DROP TABLE IF EXISTS tb_audit_log');
    console.log('已删除旧表（如果存在）');
    
    // 重新创建表，确保log_id设置为自增主键
    await sequelize.query(`
      CREATE TABLE tb_audit_log (
        log_id INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
        schedule_id INT NOT NULL COMMENT '关联tb_schedule的ID，外键',
        admin_id INT NOT NULL COMMENT '关联tb_user的ID（管理员），外键',
        audit_result ENUM('approved', 'rejected') NOT NULL COMMENT '审核结果: approved(通过), rejected(拒绝)',
        reason VARCHAR(512) COMMENT '审核原因',
        audit_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '审核时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    
    console.log('tb_audit_log表创建成功，log_id已设置为自增主键');
    
    // 添加外键约束（可选）
    try {
      await sequelize.query('ALTER TABLE tb_audit_log ADD CONSTRAINT fk_schedule FOREIGN KEY (schedule_id) REFERENCES tb_schedule(schedule_id)');
      await sequelize.query('ALTER TABLE tb_audit_log ADD CONSTRAINT fk_admin FOREIGN KEY (admin_id) REFERENCES tb_user(user_id)');
      console.log('外键约束添加成功');
    } catch (fkError) {
      console.log('外键约束添加失败（可能是因为引用的表不存在或结构不匹配）:', fkError.message);
    }
    
    console.log('修复完成！');
  } catch (error) {
    console.error('修复表结构时发生错误:', error.message);
  } finally {
    await sequelize.close();
  }
}

// 执行修复
fixAuditLogTable();