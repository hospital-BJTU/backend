// 导入数据库配置
const { sequelize } = require('../config/database');

// 导入所有模型模块
const userModelModule = require('./User');
const departmentModelModule = require('./Department');
const doctorModelModule = require('./Doctor');
const scheduleModelModule = require('./Schedule');
const appointmentModelModule = require('./Appointment');
const auditLogModelModule = require('./AuditLog');
const callLogModelModule = require('./CallLog');
const antiHoardingLogModelModule = require('./AntiHoardingLog');
const smsVerificationModelModule = require('./SmsVerification');

// 初始化并获取实际的模型实例
const User = userModelModule.initiate(sequelize);
const Department = departmentModelModule.initiate(sequelize);
const Doctor = doctorModelModule.initiate(sequelize);
const Schedule = scheduleModelModule.initiate(sequelize);
const Appointment = appointmentModelModule.initiate(sequelize);
const AuditLog = auditLogModelModule.initiate(sequelize);
const CallLog = callLogModelModule.initiate(sequelize);
const AntiHoardingLog = antiHoardingLogModelModule.initiate(sequelize);
const SmsVerification = smsVerificationModelModule.initiate(sequelize);

// 设置模型之间的关联关系
// Doctor与User关联 - 使用数据库字段名
User.hasOne(Doctor, { foreignKey: 'user_id' });
Doctor.belongsTo(User, { foreignKey: 'user_id' });

// Doctor与Department关联 - 使用数据库字段名
Department.hasMany(Doctor, { foreignKey: 'dept_id' });
Doctor.belongsTo(Department, { foreignKey: 'dept_id' });

// Doctor与Schedule关联
Doctor.hasMany(Schedule, { foreignKey: 'doctor_id' });
Schedule.belongsTo(Doctor, { foreignKey: 'doctor_id' });

// AntiHoardingLog与User关联
User.hasMany(AntiHoardingLog, { foreignKey: 'user_id' });
AntiHoardingLog.belongsTo(User, { foreignKey: 'user_id' });

// CallLog与Appointment关联
Appointment.hasMany(CallLog, { foreignKey: 'appt_id' });
CallLog.belongsTo(Appointment, { foreignKey: 'appt_id' });

// CallLog与Doctor关联
Doctor.hasMany(CallLog, { foreignKey: 'doctor_id' });
CallLog.belongsTo(Doctor, { foreignKey: 'doctor_id' });

// Appointment与Schedule关联
Schedule.hasMany(Appointment, { foreignKey: 'schedule_id' });
Appointment.belongsTo(Schedule, { foreignKey: 'schedule_id' });

// AuditLog与Schedule关联
Schedule.hasMany(AuditLog, { foreignKey: 'schedule_id' });
AuditLog.belongsTo(Schedule, { foreignKey: 'schedule_id' });

// AuditLog与User关联（管理员）
User.hasMany(AuditLog, { as: 'AdminLogs', foreignKey: 'admin_id' });
AuditLog.belongsTo(User, { as: 'Admin', foreignKey: 'admin_id' });

// Appointment与User关联
User.hasMany(Appointment, { foreignKey: 'user_id' });
Appointment.belongsTo(User, { foreignKey: 'user_id' });

// 导出模型，同时确保命名一致性
module.exports = {
  sequelize,
  User,
  Department,
  Doctor,
  Schedule,
  Appointment,
  AuditLog,
  CallLog,
  AntiHoardingLog,
  SmsVerification
};