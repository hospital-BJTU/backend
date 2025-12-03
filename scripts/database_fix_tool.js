#!/usr/bin/env node
// 加载环境变量
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { sequelize } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

// 彩色输出函数
function logSuccess(message) {
  console.log('\x1b[32m✓ ' + message + '\x1b[0m');
}

function logError(message) {
  console.log('\x1b[31m✗ ' + message + '\x1b[0m');
}

function logInfo(message) {
  console.log('\x1b[36mℹ ' + message + '\x1b[0m');
}

function logWarning(message) {
  console.log('\x1b[33m! ' + message + '\x1b[0m');
}

// 修复tb_schedule表的函数
async function fixScheduleTable() {
  try {
    logInfo('开始修复tb_schedule表...');
    
    // 检查表是否存在
    const [tables] = await sequelize.query(
      "SHOW TABLES LIKE 'tb_schedule';"
    );
    
    if (tables.length === 0) {
      logWarning('tb_schedule表不存在，无法修复');
      return false;
    }
    
    // 1. 临时禁用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
    logInfo('已禁用外键检查');
    
    // 2. 修改schedule_id字段为AUTO_INCREMENT
    await sequelize.query(`
      ALTER TABLE tb_schedule 
      MODIFY COLUMN schedule_id INT AUTO_INCREMENT;
    `);
    logSuccess('schedule_id字段修复成功');
    
    // 3. 检查并更新audit_status字段的枚举值
    // 先检查audit_status字段是否已包含所需枚举值
    const [columns] = await sequelize.query(
      "SHOW COLUMNS FROM tb_schedule WHERE Field = 'audit_status';"
    );
    
    if (columns.length > 0) {
      const enumValues = columns[0].Type;
      // 检查是否已经包含所需的枚举值
      if (enumValues.includes('leave_requested') && enumValues.includes('cancelled')) {
        logInfo('tb_schedule表的audit_status字段枚举值已包含所有所需值（leave_requested和cancelled）');
      } else {
        logInfo('发现audit_status字段枚举值不完整，需要更新');
        await sequelize.query(`
          ALTER TABLE tb_schedule 
          MODIFY COLUMN audit_status ENUM('pending', 'approved', 'rejected', 'leave_requested', 'cancelled') NOT NULL DEFAULT 'pending';
        `);
        logSuccess('audit_status字段修复成功，已添加leave_requested和cancelled值');
      }
    } else {
        logError('audit_status字段不存在于tb_schedule表中');
        return false;  // 添加返回值
    }
    
    // 4. 重新启用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
    logInfo('已重新启用外键检查');
    
    logSuccess('tb_schedule表结构修复完成！');
    return true;
  } catch (error) {
    logError('修复tb_schedule表结构时出错: ' + error.message);
    return false;
  }
}

// 修复tb_user表的函数
async function fixUserTable() {
  try {
    logInfo('开始修复tb_user表...');
    
    // 检查表是否存在
    const [tables] = await sequelize.query(
      "SHOW TABLES LIKE 'tb_user';"
    );
    
    if (tables.length === 0) {
      logWarning('tb_user表不存在，无法修复');
      return false;
    }
    
    // 检查account_status字段是否已存在
    const [columns] = await sequelize.query(
      "SHOW COLUMNS FROM tb_user WHERE Field = 'account_status';"
    );
    
    if (columns.length > 0) {
      logInfo('account_status字段已存在于tb_user表中');
      // 检查字段类型是否正确
      const enumValues = columns[0].Type;
      if (enumValues.includes('active') && enumValues.includes('banned') && enumValues.includes('temp_locked')) {
        logInfo('account_status字段类型和枚举值已正确配置');
        logSuccess('tb_user表无需修复！');
        return true;
      } else {
        logInfo('account_status字段类型不正确，需要修改');
        // 修改字段类型
        await sequelize.query(`
          ALTER TABLE tb_user 
          MODIFY COLUMN account_status ENUM('active', 'banned', 'temp_locked') NOT NULL DEFAULT 'active' COMMENT '账户状态: active(正常), banned(永久封禁), temp_locked(暂时锁定)';
        `);
        logSuccess('account_status字段类型修复成功');
      }
    } else {
      logInfo('account_status字段不存在，将添加到tb_user表中');
      // 添加account_status字段
      await sequelize.query(`
        ALTER TABLE tb_user 
        ADD COLUMN account_status ENUM('active', 'banned', 'temp_locked') NOT NULL DEFAULT 'active' COMMENT '账户状态: active(正常), banned(永久封禁), temp_locked(暂时锁定)';
      `);
      logSuccess('account_status字段添加成功');
    }
    
    logSuccess('tb_user表修复完成！');
    return true;
  } catch (error) {
    logError('修复tb_user表时出错: ' + error.message);
    return false;
  }
}

// 修复tb_audit_log表的函数
async function fixAuditLogTable() {
  try {
    logInfo('开始修复tb_audit_log表结构...');
    
    // 检查表是否存在
    const [tables] = await sequelize.query(
      "SHOW TABLES LIKE 'tb_audit_log';"
    );
    
    // 表不存在或需要修复的标志
    let needToRecreate = false;
    
    if (tables.length > 0) {
      logInfo('tb_audit_log表已存在，正在检查表结构...');
      
      // 检查log_id字段是否为自增主键
      const [columns] = await sequelize.query(
        "SHOW COLUMNS FROM tb_audit_log WHERE Field = 'log_id';"
      );
      
      // 检查是否缺少必要字段
      const [allColumns] = await sequelize.query(
        "SHOW COLUMNS FROM tb_audit_log;"
      );
      
      // 检查需要添加的新字段（保持向后兼容）
      const newFieldsToAdd = ['action_type', 'target_id', 'action_result', 'details', 'action_time'];
      const existingFields = allColumns.map(col => col.Field);
      const missingFields = newFieldsToAdd.filter(field => !existingFields.includes(field));
      
      // 判断是否需要添加新字段
      if (missingFields.length > 0) {
        logInfo(`需要添加新字段: ${missingFields.join(', ')}`);
        
        // 逐个添加缺失的字段（保持向后兼容）
        for (const field of missingFields) {
          try {
            switch(field) {
              case 'action_type':
                await sequelize.query(`ALTER TABLE tb_audit_log ADD COLUMN action_type ENUM('schedule_audit', 'user_status_change') COMMENT '操作类型: schedule_audit(排班审核), user_status_change(用户状态变更)'`);
                break;
              case 'target_id':
                await sequelize.query('ALTER TABLE tb_audit_log ADD COLUMN target_id INT COMMENT "目标ID（排班ID或用户ID）"');
                break;
              case 'action_result':
                await sequelize.query(`ALTER TABLE tb_audit_log ADD COLUMN action_result ENUM('approved', 'rejected', 'active', 'banned', 'temp_locked', 'pending') COMMENT '操作结果'`);
                break;
              case 'details':
                await sequelize.query('ALTER TABLE tb_audit_log ADD COLUMN details JSON COMMENT "操作详情（JSON格式）"');
                break;
              case 'action_time':
                await sequelize.query('ALTER TABLE tb_audit_log ADD COLUMN action_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT "操作时间"');
                break;
            }
            logSuccess(`已添加字段: ${field}`);
          } catch (error) {
            logWarning(`添加字段 ${field} 失败: ${error.message}`);
          }
        }
      } else {
        logInfo('所有新字段已存在');
      }
      
      // 检查log_id字段是否为自增主键
      if (!columns.length || !columns[0].Extra.includes('auto_increment')) {
        logWarning('log_id字段不是自增主键，需要修复');
        needToRecreate = true;
      } else {
        logInfo('表结构检查通过，log_id字段已正确设置为自增主键且所有必要字段都存在');
        logSuccess('tb_audit_log表无需修复！');
        return true;
      }
      
      if (needToRecreate) {
        logWarning('表结构不符合要求，将被删除并重新创建');
        logWarning('警告：这将丢失所有现有的审核日志数据！');
        
        // 先尝试删除表
        await sequelize.query('DROP TABLE IF EXISTS tb_audit_log');
        logInfo('已删除旧表');
      }
    } else {
      // 表不存在，需要创建
      needToRecreate = true;
    }
    
    // 只有在需要时才重新创建表
    if (needToRecreate) {
      // 重新创建表，确保log_id设置为自增主键
      await sequelize.query(`
        CREATE TABLE tb_audit_log (
          log_id INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
          schedule_id INT NOT NULL COMMENT '关联tb_schedule的ID，外键',
          admin_id INT NOT NULL COMMENT '关联tb_user的ID（管理员），外键',
          audit_result VARCHAR(50) COMMENT '审核结果（向后兼容）',
          reason VARCHAR(512) COMMENT '审核原因',
          audit_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '审核时间'
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
    } else {
      logInfo('表结构符合要求，无需重新创建表');
      // 直接检查并添加外键约束
      try {
        // 检查外键约束是否存在
        const [fkConstraints] = await sequelize.query(`
          SELECT COUNT(*) as count FROM information_schema.KEY_COLUMN_USAGE 
          WHERE TABLE_NAME = 'tb_audit_log' AND 
          CONSTRAINT_NAME IN ('fk_schedule', 'fk_admin');
        `);
        
        if (fkConstraints[0].count < 2) {
          // 至少有一个外键约束不存在，尝试添加
          await sequelize.query('ALTER TABLE tb_audit_log ADD CONSTRAINT fk_schedule FOREIGN KEY (schedule_id) REFERENCES tb_schedule(schedule_id)');
          await sequelize.query('ALTER TABLE tb_audit_log ADD CONSTRAINT fk_admin FOREIGN KEY (admin_id) REFERENCES tb_user(user_id)');
          logSuccess('外键约束添加/更新成功');
        } else {
          logInfo('外键约束已存在');
        }
        
        logSuccess('tb_audit_log表结构验证完成！');
        return true;
      } catch (fkError) {
        logWarning('外键约束操作失败（可能是因为引用的表不存在或结构不匹配）: ' + fkError.message);
        logSuccess('tb_audit_log表结构基本验证完成，仅外键约束存在问题');
        return true;
      }
    }
    
    logSuccess('tb_audit_log表创建成功，log_id已设置为自增主键');
    
    // 只有在重新创建表后才尝试添加外键约束
    if (needToRecreate) {
      // 添加外键约束
      try {
        await sequelize.query('ALTER TABLE tb_audit_log ADD CONSTRAINT fk_schedule FOREIGN KEY (schedule_id) REFERENCES tb_schedule(schedule_id)');
        await sequelize.query('ALTER TABLE tb_audit_log ADD CONSTRAINT fk_admin FOREIGN KEY (admin_id) REFERENCES tb_user(user_id)');
        logSuccess('外键约束添加成功');
      } catch (fkError) {
        logWarning('外键约束添加失败（可能是因为引用的表不存在或结构不匹配）: ' + fkError.message);
      }
    }
    
    logSuccess('tb_audit_log表修复完成！');
    return true;
  } catch (error) {
    logError('修复tb_audit_log表结构时发生错误: ' + error.message);
    return false;
  }
}

// 修复tb_anti_hoarding_log表的函数
async function fixAntiHoardingLogTable() {
  try {
    logInfo('开始修复tb_anti_hoarding_log表结构...');
    
    // 检查表是否存在
    const [tables] = await sequelize.query(
      "SHOW TABLES LIKE 'tb_anti_hoarding_log';"
    );
    
    if (tables.length === 0) {
      logWarning('tb_anti_hoarding_log表不存在，无法修复');
      return false;
    }
    
    // 临时禁用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
    logInfo('已禁用外键检查');
    
    // 检查log_id字段是否为自增主键
    const [logIdColumn] = await sequelize.query(
      "SHOW COLUMNS FROM tb_anti_hoarding_log WHERE Field = 'log_id';"
    );
    
    if (logIdColumn.length > 0) {
      // 检查log_id字段是否已设置为自增
      if (!logIdColumn[0].Extra.includes('auto_increment')) {
        logInfo('发现log_id字段未设置为自增，正在修复...');
        await sequelize.query(`
          ALTER TABLE tb_anti_hoarding_log 
          MODIFY COLUMN log_id INT AUTO_INCREMENT;
        `);
        logSuccess('log_id字段已修复为自增');
      } else {
        logInfo('log_id字段已正确设置为自增');
      }
    } else {
      logError('log_id字段不存在于tb_anti_hoarding_log表中');
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
      return false;
    }
    
    // 检查log_type字段的枚举值
    const [logTypeColumn] = await sequelize.query(
      "SHOW COLUMNS FROM tb_anti_hoarding_log WHERE Field = 'log_type';"
    );
    
    if (logTypeColumn.length > 0) {
      const enumValues = logTypeColumn[0].Type;
      // 检查是否已经包含所需的枚举值（根据AntiHoardingLog模型定义）
      const requiredEnumValues = ['high_frequency', 'same_ip_multi_user', 'illegal_operation', 'user_hoarding_attempt'];
      const allValuesIncluded = requiredEnumValues.every(value => enumValues.includes(value));
      
      if (allValuesIncluded) {
        logInfo('log_type字段枚举值已包含所有所需值');
      } else {
        logInfo('发现log_type字段枚举值不完整，需要更新');
        await sequelize.query(`
          ALTER TABLE tb_anti_hoarding_log 
          MODIFY COLUMN log_type ENUM('high_frequency', 'same_ip_multi_user', 'illegal_operation', 'user_hoarding_attempt') NOT NULL;
        `);
        logSuccess('log_type字段枚举值修复成功，已添加所有所需值');
      }
    } else {
      logError('log_type字段不存在于tb_anti_hoarding_log表中');
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
      return false;
    }
    
    // 重新启用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
    logInfo('已重新启用外键检查');
    
    logSuccess('tb_anti_hoarding_log表结构修复完成！');
    return true;
  } catch (error) {
    logError('修复tb_anti_hoarding_log表结构时发生错误: ' + error.message);
    // 确保重新启用外键检查
    try {
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
    } catch (e) {
      // 忽略错误
    }
    return false;
  }
}

// 运行所有修复的函数
async function runAllFixes() {
  let success = true;
  
  logInfo('开始执行所有数据库修复操作...');
  console.log('='.repeat(60));
  
  // 先修复schedule表，因为audit_log表依赖于它
  const scheduleResult = await fixScheduleTable();
  success = success && scheduleResult;
  
  console.log('='.repeat(60));
  
  const userResult = await fixUserTable();
  success = success && userResult;
  
  console.log('='.repeat(60));
  
  const auditLogResult = await fixAuditLogTable();
  success = success && auditLogResult;
  
  console.log('='.repeat(60));
  
  const antiHoardingLogResult = await fixAntiHoardingLogTable();
  success = success && antiHoardingLogResult;
  
  console.log('='.repeat(60));
  
  if (success) {
    logSuccess('所有数据库修复操作已成功完成！');
  } else {
    logError('部分修复操作失败，请查看上面的错误信息');
  }
  
  return success;
}

// 显示帮助信息
function showHelp() {
  console.log('数据库修复工具使用说明:');
  console.log('');
  console.log('  node scripts/database_fix_tool.js [选项]');
  console.log('');
  console.log('选项:');
  console.log('  --all, -a          运行所有修复操作（默认）');
  console.log('  --schedule, -s     仅修复tb_schedule表');
  console.log('  --user, -u         仅修复tb_user表');
  console.log('  --audit-log, -l    仅修复tb_audit_log表');
  console.log('  --anti-hoarding, -o仅修复tb_anti_hoarding_log表');
  console.log('  --help, -h         显示此帮助信息');
  console.log('');
  console.log('示例:');
  console.log('  node scripts/database_fix_tool.js');
  console.log('  node scripts/database_fix_tool.js --schedule');
  console.log('  node scripts/database_fix_tool.js --user');
  console.log('  node scripts/database_fix_tool.js -l');
  console.log('  node scripts/database_fix_tool.js --anti-hoarding');
}

// 主函数
async function main() {
  try {
    // 解析命令行参数
    const args = process.argv.slice(2);
    let operation = 'all';
    
    for (const arg of args) {
      if (arg === '--help' || arg === '-h') {
        showHelp();
        process.exit(0);
      } else if (arg === '--schedule' || arg === '-s') {
        operation = 'schedule';
      } else if (arg === '--user' || arg === '-u') {
        operation = 'user';
      } else if (arg === '--audit-log' || arg === '-l') {
        operation = 'audit-log';
      } else if (arg === '--anti-hoarding' || arg === '-o') {
        operation = 'anti-hoarding';
      } else if (arg === '--all' || arg === '-a') {
        operation = 'all';
      } else {
        logError('未知选项: ' + arg);
        showHelp();
        process.exit(1);
      }
    }
    
    // 显示欢迎信息
    console.log('='.repeat(60));
    console.log('        医院管理系统数据库修复工具');
    console.log('='.repeat(60));
    
    // 执行相应的修复操作
    let success = false;
    
    switch (operation) {
      case 'schedule':
        success = await fixScheduleTable();
        break;
      case 'user':
        success = await fixUserTable();
        break;
      case 'audit-log':
        success = await fixAuditLogTable();
        break;
      case 'anti-hoarding':
        success = await fixAntiHoardingLogTable();
        break;
      case 'all':
      default:
        success = await runAllFixes();
        break;
    }
    
    console.log('\n数据库修复工具执行完毕');
    process.exit(success ? 0 : 1);
  } catch (error) {
    logError('工具执行过程中发生未预期错误: ' + error.message);
    process.exit(1);
  } finally {
    // 确保关闭数据库连接
    try {
      if (sequelize && sequelize.connectionManager) {
        await sequelize.close();
        logInfo('数据库连接已关闭');
      }
    } catch (closeError) {
      logWarning('关闭数据库连接时出错: ' + closeError.message);
    }
  }
}

// 运行主函数
if (require.main === module) {
  main();
}

// 导出函数以便在其他地方使用
module.exports = {
  fixScheduleTable,
  fixUserTable,
  fixAuditLogTable,
  fixAntiHoardingLogTable,
  runAllFixes
};