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
// Doctor与User关联
User.hasOne(Doctor, { foreignKey: 'userId' });
Doctor.belongsTo(User, { foreignKey: 'userId' });

// Doctor与Department关联
Department.hasMany(Doctor, { foreignKey: 'deptId' });
Doctor.belongsTo(Department, { foreignKey: 'deptId' });

// Doctor与Schedule关联
Doctor.hasMany(Schedule, { foreignKey: 'doctorId' });
Schedule.belongsTo(Doctor, { foreignKey: 'doctorId' });

// AntiHoardingLog与User关联
User.hasMany(AntiHoardingLog, { foreignKey: 'userId' });
AntiHoardingLog.belongsTo(User, { foreignKey: 'userId' });

// CallLog与Appointment关联
Appointment.hasMany(CallLog, { foreignKey: 'apptId' });
CallLog.belongsTo(Appointment, { foreignKey: 'apptId' });

// CallLog与Doctor关联
Doctor.hasMany(CallLog, { foreignKey: 'doctorId' });
CallLog.belongsTo(Doctor, { foreignKey: 'doctorId' });

// Appointment与Schedule关联
Schedule.hasMany(Appointment, { foreignKey: 'scheduleId' });
Appointment.belongsTo(Schedule, { foreignKey: 'scheduleId' });

// AuditLog与Schedule关联
Schedule.hasMany(AuditLog, { foreignKey: 'scheduleId' });
AuditLog.belongsTo(Schedule, { foreignKey: 'scheduleId' });

// AuditLog与User关联（管理员）
User.hasMany(AuditLog, { as: 'AdminLogs', foreignKey: 'adminId' });
AuditLog.belongsTo(User, { as: 'Admin', foreignKey: 'adminId' });

// Appointment与User关联
User.hasMany(Appointment, { foreignKey: 'userId' });
Appointment.belongsTo(User, { foreignKey: 'userId' });

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