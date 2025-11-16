const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置信息
const API_BASE_URL = 'http://localhost:3000/api'; // API基础URL
const CONCURRENCY_COUNT = 1000; // 并发请求数量
const TEST_SCHEDULE_ID = 104; // 测试用的排班ID，请根据实际情况修改
const USER_CREDENTIALS = [
  { username: 'patient_li', password: 'pwd123' }, // 使用系统中可能存在的默认用户
  { username: 'admin_super', password: 'pwd123' }
]; // 测试用户凭据

// 日志级别配置
const LOG_LEVEL = 'INFO'; // 可选值: ERROR, INFO, DEBUG

// 创建测试ID，用于区分不同批次的测试
const TEST_ID = `test_${Date.now()}`;
const LOG_FILE = `concurrency_test_${TEST_ID}.log`;

// 存储结果
const results = {
  testId: TEST_ID,
  startTime: new Date().toISOString(),
  endTime: null,
  totalDuration: null,
  success: 0,
  failed: 0,
  errors: [],
  details: [],
  config: {
    concurrencyCount: CONCURRENCY_COUNT,
    scheduleId: TEST_SCHEDULE_ID,
    apiBaseUrl: API_BASE_URL
  }
};

// 日志级别权重
const LOG_LEVELS = {
  ERROR: 0,
  INFO: 1,
  DEBUG: 2
};

// 记录日志，支持不同日志级别，根据配置决定是否输出到控制台
function log(message, level = 'INFO') {
  // 检查日志级别
  if (LOG_LEVELS[level] > LOG_LEVELS[LOG_LEVEL]) {
    // 如果当前日志级别高于配置的级别，只写入文件不输出到控制台
    if (level === 'DEBUG') {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [${level}] ${message}`;
      fs.appendFileSync(LOG_FILE, logMessage + '\n');
      return;
    }
  }
  
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// 记录详细的错误信息
function logError(message, error = null, context = null) {
  const timestamp = new Date().toISOString();
  let errorMessage = `[${timestamp}] [ERROR] ${message}`;
  
  // 添加上下文信息
  if (context) {
    errorMessage += `\n[CONTEXT] ${JSON.stringify(context)}`; // 简化JSON输出
  }
  
  // 添加错误对象信息
  if (error) {
    if (error.response) {
      errorMessage += `\n[RESPONSE] ${error.response.status}: ${error.response.data?.message || '服务器错误'}`;
    } else if (error.request) {
      errorMessage += `\n[NO RESPONSE] ${error.message}`;
    } else {
      errorMessage += `\n[ERROR] ${error.message}`;
    }
  }
  
  console.error(errorMessage);
  fs.appendFileSync(LOG_FILE, errorMessage + '\n\n');
  return errorMessage;
}

// 用户登录获取token
async function login(username, password, attempt = 1) {
  const maxAttempts = 3;
  try {
    log(`尝试登录用户: ${username} (尝试 ${attempt}/${maxAttempts})`);
    const loginUrl = `${API_BASE_URL}/users/login`;
    log(`登录请求URL: ${loginUrl}`);
    
    const response = await axios.post(loginUrl, {
      username,
      password
    }, {
      timeout: 10000, // 10秒超时
      validateStatus: status => status >= 200 && status < 500 // 只在非服务器错误时拒绝
    });
    
    if (response.data && response.data.data && response.data.data.token) {
      log(`用户 ${username} 登录成功，获取到token`);
      return response.data.data.token;
    } else {
      const errorMessage = `登录响应格式错误: ${JSON.stringify(response.data)}`;
      logError(errorMessage, null, { username, response: response.data });
      throw new Error(errorMessage);
    }
  } catch (error) {
    // 分析详细的登录错误
    let detailedError;
    
    if (error.response) {
      // 服务器返回了错误响应
      const errorCode = error.response.status;
      const errorData = error.response.data;
      const errorMsg = errorData?.message || '未知错误';
      const errorDetails = errorData?.error || errorData?.details || {};
      
      detailedError = {
        message: `登录失败: ${username}, HTTP状态: ${errorCode}, 错误: ${errorMsg}`,
        code: errorCode,
        data: errorData,
        details: errorDetails
      };
      
      logError(
        detailedError.message,
        error,
        { username, errorCode, errorData, errorDetails }
      );
    } else if (error.request) {
      // 请求已发送但未收到响应
      detailedError = {
        message: `登录失败: ${username}, 服务器无响应: ${error.message}`,
        code: 'NO_RESPONSE'
      };
      logError(detailedError.message, error, { username });
    } else {
      // 请求配置出错
      detailedError = {
        message: `登录失败: ${username}, 请求配置错误: ${error.message}`,
        code: 'REQUEST_ERROR'
      };
      logError(detailedError.message, error, { username });
    }
    
    // 如果是网络问题，尝试重试
    if ((error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') && attempt < maxAttempts) {
      log(`网络问题，${attempt}秒后重试登录用户 ${username}...`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      return login(username, password, attempt + 1);
    }
    
    throw new Error(JSON.stringify(detailedError));
  }
}

// 发送预约请求
async function createAppointment(token, userId, requestId) {
  const startTime = Date.now();
  const requestDetails = {
    requestId,
    userId,
    scheduleId: TEST_SCHEDULE_ID
  };
  
  // 简化日志，只记录关键信息
  if (LOG_LEVEL === 'DEBUG') {
    log(`请求 ${requestId} (用户${userId}) 开始发送预约请求`, 'DEBUG');
  }
  
  try {
    const appointmentUrl = `${API_BASE_URL}/appointments`;
    const response = await axios.post(appointmentUrl, {
      scheduleId: TEST_SCHEDULE_ID,
      specificTimeSlot: `测试时段-${requestId}`
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-User-ID': userId
      },
      timeout: 30000 // 30秒超时
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    const appointmentId = response.data?.data?.apptId || response.data?.data?.id;
    const serialNumber = response.data?.data?.serialNumber;
    
    // 只记录关键成功信息
    log(`请求 ${requestId} (用户${userId}) 成功: 预约ID=${appointmentId}, 序号=${serialNumber}, 耗时: ${duration}ms`);
    
    // 保存结果到数据结构，但不输出完整JSON
    const resultEntry = {
      requestId,
      userId,
      success: true,
      duration,
      statusCode: response.status,
      data: {
        appointmentId,
        serialNumber,
        message: response.data?.message
      }
    };
    
    results.details.push(resultEntry);
    return resultEntry;
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // 简化错误信息记录
    if (error.response) {
      const errorCode = error.response.status;
      const errorMsg = error.response.data?.message || '服务器错误';
      log(`请求 ${requestId} (用户${userId}) 失败: HTTP ${errorCode} - ${errorMsg}, 耗时: ${duration}ms`);
      
      // 只在DEBUG模式下记录详细错误信息
      if (LOG_LEVEL === 'DEBUG') {
        logError(`请求 ${requestId} 失败详情`, error, { requestId, userId });
      }
    } else if (error.request) {
      log(`请求 ${requestId} (用户${userId}) 失败: 服务器无响应, 耗时: ${duration}ms`);
    } else {
      log(`请求 ${requestId} (用户${userId}) 失败: ${error.message}, 耗时: ${duration}ms`);
    }
    
    // 保存简化的错误信息
    results.details.push({
      requestId,
      userId,
      success: false,
      duration,
      error: error.response?.data?.message || error.message || '未知错误',
      statusCode: error.response?.status
    });
    
    return { requestId, userId, success: false };
  }
}

// 模拟单个用户的多次预约尝试
async function simulateUserConcurrency(username, password, userId, requestCount) {
  try {
    // 获取token
    const token = await login(username, password);
    log(`用户 ${username} 登录成功，准备发送 ${requestCount} 个预约请求`);
    
    // 模拟该用户的多次预约请求
    const requests = [];
    for (let i = 0; i < requestCount; i++) {
      const requestId = `${userId}-${i}-${Date.now()}`;
      requests.push(createAppointment(token, userId, requestId));
      // 稍微错开请求时间，避免完全同时发送
      if (i < requestCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    // 等待所有请求完成
    await Promise.allSettled(requests);
    
    // 从全局结果中过滤当前用户的请求
    const userResults = results.details.filter(item => item.userId === userId);
    const userSuccessCount = userResults.filter(item => item.success).length;
    
    log(`用户 ${username} 的预约请求完成: 成功=${userSuccessCount}, 失败=${requestCount - userSuccessCount}`);
    
    return {
      username,
      userId,
      totalRequests: requestCount,
      successfulRequests: userSuccessCount,
      failedRequests: requestCount - userSuccessCount
    };
    
  } catch (error) {
    const errorMsg = error.message || '登录失败';
    log(`用户 ${username} 的测试失败: ${errorMsg}`);
    return {
      username,
      userId,
      totalRequests: requestCount,
      successfulRequests: 0,
      failedRequests: requestCount,
      error: errorMsg
    };
  }
}

// 分析结果 - 简化版本，保持核心功能
function analyzeResults() {
  // 统计成功和失败的请求数
  results.success = results.details.filter(item => item.success).length;
  results.failed = results.details.filter(item => !item.success).length;
  
  // 简化的错误类型统计
  const errorTypes = {};
  results.details.forEach(item => {
    if (!item.success) {
      const statusCode = item.statusCode || 'UNKNOWN';
      errorTypes[statusCode] = (errorTypes[statusCode] || 0) + 1;
    }
  });
  
  // 简化的响应时间统计
  let responseStats = {};
  if (results.details.length > 0) {
    const durations = results.details.map(item => item.duration);
    responseStats = {
      average: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
      max: Math.max(...durations),
      min: Math.min(...durations)
    };
  }
  
  // 检查重复的预约号或序号
  let duplicateIssues = [];
  if (results.success > 0) {
    const appointmentIds = new Set();
    const serialNumbers = new Map();
    
    results.details.filter(item => item.success && item.data).forEach(item => {
      const apptId = item.data.appointmentId;
      const serialNum = item.data.serialNumber;
      
      // 检查重复预约ID
      if (apptId && appointmentIds.has(apptId)) {
        duplicateIssues.push(`重复预约ID: ${apptId}`);
      } else if (apptId) {
        appointmentIds.add(apptId);
      }
      
      // 检查重复序号
      if (serialNum) {
        if (!serialNumbers.has(serialNum)) {
          serialNumbers.set(serialNum, []);
        }
        serialNumbers.get(serialNum).push(item.requestId);
      }
    });
    
    // 检查重复序号
    serialNumbers.forEach((requestIds, serialNum) => {
      if (requestIds.length > 1) {
        duplicateIssues.push(`重复序号: ${serialNum}`);
      }
    });
  }
  
  // 计算成功率
  const successRate = results.details.length > 0 ? 
    (results.success / results.details.length * 100).toFixed(2) : 0;
  
  // 构建简化的报告
  const report = {
    testId: TEST_ID,
    startTime: results.startTime,
    endTime: results.endTime,
    totalDuration: results.totalDuration,
    totalRequests: results.details.length,
    successfulRequests: results.success,
    failedRequests: results.failed,
    successRate: `${successRate}%`,
    errorTypes,
    responseStats,
    duplicateIssues,
    config: results.config,
    // 成功预约的核心信息
    successfulAppointments: results.details
      .filter(item => item.success && item.data)
      .map(item => ({
        requestId: item.requestId,
        userId: item.userId,
        appointmentId: item.data.appointmentId,
        serialNumber: item.data.serialNumber,
        duration: item.duration
      }))
  };
  
  return report;
}

// 保存结果到文件 - 简化输出
function saveResults(report) {
  // 确保结果目录存在
  const resultsDir = 'concurrency_test_results';
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  // 保存分析报告
  const reportFilePath = path.join(resultsDir, `concurrency_test_${TEST_ID}_report.json`);
  fs.writeFileSync(reportFilePath, JSON.stringify(report));
  log(`测试报告已保存到 ${reportFilePath}`);
  
  // 同时保存到根目录作为最新结果
  fs.writeFileSync('concurrency_test_report.json', JSON.stringify(report));
  
  return { reportFilePath };
}

// 输出总结报告到控制台 - 简化版
function printSummaryReport(report) {
  console.log('\n========================================');
  console.log('       并发测试结果总结');
  console.log('========================================');
  console.log(`测试ID: ${report.testId}`);
  console.log(`总耗时: ${report.totalDuration}ms`);
  console.log(`总请求数: ${report.totalRequests}`);
  console.log(`成功请求: ${report.successfulRequests} (${report.successRate})`);
  console.log(`失败请求: ${report.failedRequests}`);
  
  if (Object.keys(report.errorTypes).length > 0) {
    console.log('\n错误类型统计:');
    Object.entries(report.errorTypes).forEach(([errorType, count]) => {
      console.log(`  - HTTP ${errorType}: ${count}次`);
    });
  }
  
  console.log('\n响应时间统计:');
  console.log(`  - 平均: ${report.responseStats.average}ms`);
  console.log(`  - 最大: ${report.responseStats.max}ms`);
  console.log(`  - 最小: ${report.responseStats.min}ms`);
  
  if (report.successfulAppointments.length > 0) {
    console.log('\n成功预约信息:');
    report.successfulAppointments.forEach(appt => {
      console.log(`  - 预约ID: ${appt.appointmentId}, 序号: ${appt.serialNumber}, 用户ID: ${appt.userId}`);
    });
  }
  
  if (report.duplicateIssues.length > 0) {
    console.log('\n⚠️  检测到数据一致性问题:');
    report.duplicateIssues.forEach(issue => {
      console.log(`  - ${issue}`);
    });
  }
  
  console.log('\n========================================');
  console.log(`报告文件: ${path.join('concurrency_test_results', `concurrency_test_${TEST_ID}_report.json`)}`);
  console.log(`日志文件: ${LOG_FILE}`);
  console.log('========================================\n');
}

// 主函数 - 简化日志输出
async function runConcurrencyTest() {
  log('开始预约并发测试...');
  log(`配置: 并发数=${CONCURRENCY_COUNT}, 排班ID=${TEST_SCHEDULE_ID}`);
  
  const startTime = Date.now();
  
  try {
    // 每个用户分担一部分并发请求
    const requestsPerUser = Math.ceil(CONCURRENCY_COUNT / USER_CREDENTIALS.length);
    log(`每个用户将发送 ${requestsPerUser} 个预约请求`);
    
    const userTests = USER_CREDENTIALS.map((credentials, index) => {
      const userId = index + 1;
      return simulateUserConcurrency(
        credentials.username, 
        credentials.password, 
        userId,
        requestsPerUser
      );
    });
    
    // 等待所有用户测试完成
    log('开始并发测试...');
    await Promise.all(userTests);
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // 更新结果时间信息
    results.endTime = new Date().toISOString();
    results.totalDuration = totalDuration;
    
    log(`所有测试完成，总耗时: ${totalDuration}ms`);
    
    // 分析结果
    const report = analyzeResults();
    
    // 保存结果
    const savedFiles = saveResults(report);
    
    // 输出总结报告
    printSummaryReport(report);
    
    log(`测试完成! 报告请查看 ${savedFiles.reportFilePath}`);
    
  } catch (error) {
    log(`测试过程中发生错误: ${error.message}`);
    
    // 即使发生错误，也尝试保存已有的结果
    try {
      const endTime = Date.now();
      results.endTime = new Date().toISOString();
      results.totalDuration = endTime - startTime;
      
      const report = analyzeResults();
      saveResults(report);
      log('已保存部分测试结果');
    } catch (saveError) {
      log(`保存测试结果失败: ${saveError.message}`);
    }
  }
}

// 运行测试
runConcurrencyTest();