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
    
    // 4. 检查并更新time_slot字段的枚举值
    const [timeSlotColumns] = await sequelize.query(
      "SHOW COLUMNS FROM tb_schedule WHERE Field = 'time_slot';"
    );
    
    if (timeSlotColumns.length > 0) {
      const enumValues = timeSlotColumns[0].Type;
      // 检查是否已经包含所需的枚举值
      if (enumValues.includes('08:00-09:00')) {
        logInfo('tb_schedule表的time_slot字段枚举值已包含所有所需值');
      } else {
        logInfo('发现time_slot字段枚举值需要更新，从AM/PM改为具体时间段');
        
        // 方法：先转为VARCHAR，更新值后再转回ENUM
        // 1. 将字段类型改为VARCHAR
        await sequelize.query(`
          ALTER TABLE tb_schedule 
          MODIFY COLUMN time_slot VARCHAR(20) NOT NULL;
        `);
        logSuccess('已将time_slot字段类型改为VARCHAR');
        
        // 2. 更新所有AM/PM值为具体时间段
        await sequelize.query(`
          UPDATE tb_schedule SET time_slot = '09:00-10:00' WHERE time_slot = 'AM';
        `);
        await sequelize.query(`
          UPDATE tb_schedule SET time_slot = '14:00-15:00' WHERE time_slot = 'PM';
        `);
        logSuccess('已将所有time_slot值更新为具体时间段');
        
        // 3. 将字段类型改回ENUM
        await sequelize.query(`
          ALTER TABLE tb_schedule 
          MODIFY COLUMN time_slot ENUM('08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00') NOT NULL;
        `);
        logSuccess('time_slot字段修复成功，已更新为具体时间段');
      }
    } else {
        logError('time_slot字段不存在于tb_schedule表中');
        return false;
    }

    // 5. 重新启用外键检查
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
    const [accountStatusColumns] = await sequelize.query(
      "SHOW COLUMNS FROM tb_user WHERE Field = 'account_status';"
    );
    
    if (accountStatusColumns.length > 0) {
      logInfo('account_status字段已存在于tb_user表中');
      // 检查字段类型是否正确
      const enumValues = accountStatusColumns[0].Type;
      if (enumValues.includes('active') && enumValues.includes('banned') && enumValues.includes('temp_locked')) {
        logInfo('account_status字段类型和枚举值已正确配置');
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
    
    // 检查wx_openid字段是否已存在
    const [wxOpenIdColumns] = await sequelize.query(
      "SHOW COLUMNS FROM tb_user WHERE Field = 'wx_openid';"
    );
    
    if (wxOpenIdColumns.length > 0) {
      logInfo('wx_openid字段已存在于tb_user表中');
      // 检查字段类型是否正确
      const fieldType = wxOpenIdColumns[0].Type;
      if (fieldType.includes('varchar(100)') && wxOpenIdColumns[0].Null === 'YES') {
        logInfo('wx_openid字段类型和约束已正确配置');
      } else {
        logInfo('wx_openid字段类型或约束不正确，需要修改');
        // 修改字段类型和约束
        await sequelize.query(`
          ALTER TABLE tb_user 
          MODIFY COLUMN wx_openid VARCHAR(100) NULL COMMENT '微信小程序用户唯一标识';
        `);
        logSuccess('wx_openid字段类型和约束修复成功');
      }
      
      // 检查唯一性约束
      const [uniqueKeys] = await sequelize.query(
        "SHOW INDEX FROM tb_user WHERE Column_name = 'wx_openid' AND Non_unique = 0;"
      );
      
      if (uniqueKeys.length > 0) {
        logInfo('wx_openid字段的唯一性约束已存在');
      } else {
        logInfo('wx_openid字段的唯一性约束不存在，需要添加');
        await sequelize.query(`
          ALTER TABLE tb_user 
          ADD UNIQUE KEY uk_wx_openid (wx_openid);
        `);
        logSuccess('wx_openid字段的唯一性约束添加成功');
      }
    } else {
      logInfo('wx_openid字段不存在，将添加到tb_user表中');
      // 添加wx_openid字段，暂时不添加唯一键（因为表中已有太多键）
      await sequelize.query(`
        ALTER TABLE tb_user 
        ADD COLUMN wx_openid VARCHAR(100) NULL COMMENT '微信小程序用户唯一标识';
      `);
      logSuccess('wx_openid字段添加成功（未添加唯一键，将在应用层保证唯一性）');
    }
    
    logSuccess('tb_user表修复完成！');
    return true;
  } catch (error) {
    logError('修复tb_user表时出错: ' + error.message);
    logError('错误详情: ' + JSON.stringify(error, null, 2));
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

// 修复tb_schedule表的函数，添加allow_waiting字段
async function fixScheduleTableAllowWaiting() {
  try {
    logInfo('开始修复tb_schedule表的allow_waiting字段...');
    
    // 检查表是否存在
    const [tables] = await sequelize.query(
      "SHOW TABLES LIKE 'tb_schedule';"
    );
    
    if (tables.length === 0) {
      logWarning('tb_schedule表不存在，无法修复');
      return false;
    }
    
    // 检查allow_waiting字段是否已存在
    const [columns] = await sequelize.query(
      "SHOW COLUMNS FROM tb_schedule WHERE Field = 'allow_waiting';"
    );
    
    if (columns.length > 0) {
      logInfo('allow_waiting字段已存在于tb_schedule表中');
      // 更新现有记录的allow_waiting字段为true
      await sequelize.query(`
        UPDATE tb_schedule 
        SET allow_waiting = TRUE;
      `);
      logInfo('已将所有现有排班的allow_waiting字段更新为true');
    } else {
      logInfo('allow_waiting字段不存在，将添加到tb_schedule表中');
      // 添加allow_waiting字段
      await sequelize.query(`
        ALTER TABLE tb_schedule 
        ADD COLUMN allow_waiting BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否开放候补功能，默认为true';
      `);
      logSuccess('allow_waiting字段添加成功');
    }
    
    logSuccess('tb_schedule表的allow_waiting字段修复完成！');
    return true;
  } catch (error) {
    logError('修复tb_schedule表时出错: ' + error.message);
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

// 创建或修复tb_waiting_list表的函数
async function fixWaitingListTable() {
  try {
    logInfo('开始创建/修复tb_waiting_list表结构...');
    
    // 检查表是否存在
    const [tables] = await sequelize.query(
      "SHOW TABLES LIKE 'tb_waiting_list';"
    );
    
    // 临时禁用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
    logInfo('已禁用外键检查');
    
    if (tables.length === 0) {
      // 表不存在，需要创建
      logInfo('tb_waiting_list表不存在，开始创建...');
      
      await sequelize.query(`
        CREATE TABLE tb_waiting_list (
          waiting_id INT AUTO_INCREMENT PRIMARY KEY COMMENT '候补ID',
          user_id INT NOT NULL COMMENT '关联tb_user的ID，外键',
          schedule_id INT NOT NULL COMMENT '关联tb_schedule的ID，外键',
          waiting_number INT NOT NULL COMMENT '候补序号',
          waiting_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '加入候补时间',
          status ENUM('waiting', 'converted', 'cancelled', 'expired') DEFAULT 'waiting' COMMENT '候补状态',
          converted_to_appt_id INT NULL COMMENT '转换后的预约ID，关联tb_appointment表',
          converted_at DATETIME NULL COMMENT '转换为预约的时间',
          INDEX idx_user_id (user_id),
          INDEX idx_schedule_id (schedule_id),
          INDEX idx_status (status),
          UNIQUE KEY unique_user_schedule (user_id, schedule_id),
          FOREIGN KEY (user_id) REFERENCES tb_user(user_id) ON DELETE CASCADE,
          FOREIGN KEY (schedule_id) REFERENCES tb_schedule(schedule_id) ON DELETE CASCADE,
          FOREIGN KEY (converted_to_appt_id) REFERENCES tb_appointment(appt_id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      
      logSuccess('tb_waiting_list表创建成功！');
    } else {
      // 表已存在，检查并修复结构
      logInfo('tb_waiting_list表已存在，检查结构...');
      
      // 检查表结构是否符合要求
      let needToRecreate = false;
      
      // 检查必要的字段是否存在
      const [columns] = await sequelize.query(
        "SHOW COLUMNS FROM tb_waiting_list;"
      );
      
      const requiredColumns = ['waiting_id', 'user_id', 'schedule_id', 'waiting_number', 'waiting_time', 'status', 'converted_to_appt_id', 'converted_at'];
      const existingColumns = columns.map(col => col.Field);
      
      // 检查是否缺少必要字段
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
      if (missingColumns.length > 0) {
        logWarning(`缺少必要字段: ${missingColumns.join(', ')}`);
        needToRecreate = true;
      }
      
      if (needToRecreate) {
        logWarning('表结构不符合要求，将被删除并重新创建');
        logWarning('警告：这将丢失所有现有的候补数据！');
        
        // 先删除表
        await sequelize.query('DROP TABLE IF EXISTS tb_waiting_list');
        logInfo('已删除旧表');
        
        // 重新创建表
        await sequelize.query(`
          CREATE TABLE tb_waiting_list (
            waiting_id INT AUTO_INCREMENT PRIMARY KEY COMMENT '候补ID',
            user_id INT NOT NULL COMMENT '关联tb_user的ID，外键',
            schedule_id INT NOT NULL COMMENT '关联tb_schedule的ID，外键',
            waiting_number INT NOT NULL COMMENT '候补序号',
            waiting_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '加入候补时间',
            status ENUM('waiting', 'converted', 'cancelled', 'expired') DEFAULT 'waiting' COMMENT '候补状态',
            converted_to_appt_id INT NULL COMMENT '转换后的预约ID，关联tb_appointment表',
            converted_at DATETIME NULL COMMENT '转换为预约的时间',
            INDEX idx_user_id (user_id),
            INDEX idx_schedule_id (schedule_id),
            INDEX idx_status (status),
            UNIQUE KEY unique_user_schedule (user_id, schedule_id),
            FOREIGN KEY (user_id) REFERENCES tb_user(user_id) ON DELETE CASCADE,
              FOREIGN KEY (schedule_id) REFERENCES tb_schedule(schedule_id) ON DELETE CASCADE,
              FOREIGN KEY (converted_to_appt_id) REFERENCES tb_appointment(appt_id) ON DELETE SET NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
        
        logSuccess('tb_waiting_list表已重新创建！');
      } else {
        logSuccess('tb_waiting_list表结构符合要求，无需修复！');
      }
    }
    
    // 重新启用外键检查
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
    logInfo('已重新启用外键检查');
    
    return true;
  } catch (error) {
    logError('修复tb_waiting_list表结构时发生错误: ' + error.message);
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
  
  // 先修复schedule表，因为其他表可能依赖于它
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
  
  const waitingListResult = await fixWaitingListTable();
  success = success && waitingListResult;
  
  console.log('='.repeat(60));
  
  const scheduleAllowWaitingResult = await fixScheduleTableAllowWaiting();
  success = success && scheduleAllowWaitingResult;
  
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
  console.log('  --waiting-list, -w 仅创建/修复tb_waiting_list表');
  console.log('  --allow-waiting, -t 仅添加allow_waiting字段到排班级别');
  console.log('  --randomize-slots, -r 随机化现有号源的时间段');
  console.log('  --help, -h         显示此帮助信息');
  console.log('');
  console.log('示例:');
  console.log('  node scripts/database_fix_tool.js');
  console.log('  node scripts/database_fix_tool.js --schedule');
  console.log('  node scripts/database_fix_tool.js --user');
  console.log('  node scripts/database_fix_tool.js -l');
  console.log('  node scripts/database_fix_tool.js --anti-hoarding');
  console.log('  node scripts/database_fix_tool.js --waiting-list');
  console.log('  node scripts/database_fix_tool.js --randomize-slots');
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
      } else if (arg === '--waiting-list' || arg === '-w') {
        operation = 'waiting-list';
      } else if (arg === '--randomize-slots' || arg === '-r') {
        operation = 'randomize-slots';
      } else if (arg === '--allow-waiting' || arg === '-t') {
        operation = 'allow-waiting';
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
      case 'waiting-list':
        success = await fixWaitingListTable();
        break;
      case 'randomize-slots':
        success = await randomizeTimeSlots();
        break;
      case 'allow-waiting':
        success = await fixScheduleTableAllowWaiting();
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
  fixWaitingListTable,
  runAllFixes,
  randomizeTimeSlots
};

// 随机化现有号源的时间段
async function randomizeTimeSlots() {
  try {
    logInfo('开始随机化号源时间段...');
    
    // 定义所有可用的时间段
    const timeSlots = ['08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00'];
    
    // 获取所有号源记录
    const [schedules] = await sequelize.query(
      "SELECT schedule_id FROM tb_schedule;"
    );
    
    if (schedules.length === 0) {
      logWarning('未找到任何号源记录');
      return true;
    }
    
    // 逐行更新每个记录的时间段
    for (const schedule of schedules) {
      // 随机选择一个时间段
      const randomSlot = timeSlots[Math.floor(Math.random() * timeSlots.length)];
      
      // 使用简单的SQL语句直接更新
      await sequelize.query(
        `UPDATE tb_schedule SET time_slot = '${randomSlot}' WHERE schedule_id = ${schedule.schedule_id};`
      );
    }
    
    logSuccess(`已成功随机化 ${schedules.length} 条号源记录的时间段`);
    return true;
  } catch (error) {
    logError('随机化时间段时出错: ' + error.message);
    return false;
  }
}