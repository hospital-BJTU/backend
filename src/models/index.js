// 导入数据库配置
const { sequelize } = require('../config/database');

// 导入所有模型模块
const userModelModule = require('./User');
const userProfileModelModule = require('./UserProfile');
const departmentModelModule = require('./Department');
const doctorModelModule = require('./Doctor');
const scheduleModelModule = require('./Schedule');
const appointmentModelModule = require('./Appointment');
const auditLogModelModule = require('./AuditLog');
const callLogModelModule = require('./CallLog');
const antiHoardingLogModelModule = require('./AntiHoardingLog');
const smsVerificationModelModule = require('./SmsVerification');
const waitingListModelModule = require('./WaitingList');

// 初始化并获取实际的模型实例
const User = userModelModule.initiate(sequelize);
const UserProfile = userProfileModelModule.initiate(sequelize);
const Department = departmentModelModule.initiate(sequelize);
const Doctor = doctorModelModule.initiate(sequelize);
const Schedule = scheduleModelModule.initiate(sequelize);
const Appointment = appointmentModelModule.initiate(sequelize);
const AuditLog = auditLogModelModule.initiate(sequelize);
const CallLog = callLogModelModule.initiate(sequelize);
const AntiHoardingLog = antiHoardingLogModelModule.initiate(sequelize);
const SmsVerification = smsVerificationModelModule.initiate(sequelize);
const WaitingList = waitingListModelModule.initiate(sequelize);

// 将createSmartLog方法附加到AuditLog模型上
AuditLog.createSmartLog = auditLogModelModule.createSmartLog;

// 设置模型之间的关联关系

// 1. User <-> UserProfile (一对一关系)
User.hasOne(UserProfile, { foreignKey: 'user_id', onDelete: 'CASCADE' });
UserProfile.belongsTo(User, { foreignKey: 'user_id', onDelete: 'CASCADE' });

// 2. User <-> Doctor (Doctor.userId 是 NOT NULL)
User.hasOne(Doctor, { foreignKey: 'user_id', onDelete: 'CASCADE' });
Doctor.belongsTo(User, { foreignKey: 'user_id', onDelete: 'CASCADE' });

// 3. Department <-> Doctor (Doctor.deptId 是 NOT NULL)
Department.hasMany(Doctor, { foreignKey: 'dept_id', onDelete: 'CASCADE' });
Doctor.belongsTo(Department, { foreignKey: 'dept_id', onDelete: 'CASCADE' });

// 4. Doctor <-> Schedule (Schedule.doctorId 是 NOT NULL)
Doctor.hasMany(Schedule, { foreignKey: 'doctor_id', onDelete: 'CASCADE' });
Schedule.belongsTo(Doctor, { foreignKey: 'doctor_id', onDelete: 'CASCADE' });

// 5. User <-> Appointment (Appointment.userId 是 NOT NULL)
User.hasMany(Appointment, { foreignKey: 'user_id', onDelete: 'CASCADE' });
Appointment.belongsTo(User, { foreignKey: 'user_id', onDelete: 'CASCADE' });

// 6. Schedule <-> Appointment (Appointment.scheduleId 是 NOT NULL)
Schedule.hasMany(Appointment, { foreignKey: 'schedule_id', onDelete: 'CASCADE' });
Appointment.belongsTo(Schedule, { foreignKey: 'schedule_id', onDelete: 'CASCADE' });

// 7. Schedule <-> AuditLog (AuditLog.scheduleId 是 NOT NULL)
//Schedule.hasMany(AuditLog, { foreignKey: 'schedule_id', onDelete: 'CASCADE' });
//AuditLog.belongsTo(Schedule, { foreignKey: 'schedule_id', onDelete: 'CASCADE' });

// 8. User <-> AuditLog (AuditLog.adminId 是 NOT NULL)
//User.hasMany(AuditLog, { as: 'AdminLogs', foreignKey: 'admin_id', onDelete: 'CASCADE' });
//AuditLog.belongsTo(User, { foreignKey: 'admin_id', onDelete: 'CASCADE' });

// 9. Appointment <-> CallLog (CallLog.apptId 是 NOT NULL)
Appointment.hasMany(CallLog, { foreignKey: 'appt_id', onDelete: 'CASCADE' });
CallLog.belongsTo(Appointment, { foreignKey: 'appt_id', onDelete: 'CASCADE' });

// 10. Doctor <-> CallLog (CallLog.doctorId 是 NOT NULL)
Doctor.hasMany(CallLog, { foreignKey: 'doctor_id', onDelete: 'CASCADE' });
CallLog.belongsTo(Doctor, { foreignKey: 'doctor_id', onDelete: 'CASCADE' });

// 11. User <-> AntiHoardingLog (AntiHoardingLog.userId 是 allowNull: true，使用 SET NULL 或省略)
User.hasMany(AntiHoardingLog, { foreignKey: 'user_id', onDelete: 'SET NULL' });
AntiHoardingLog.belongsTo(User, { foreignKey: 'user_id', onDelete: 'SET NULL' });

// 12. User <-> WaitingList (WaitingList.userId 是 NOT NULL)
User.hasMany(WaitingList, { foreignKey: 'user_id', onDelete: 'CASCADE' });
WaitingList.belongsTo(User, { foreignKey: 'user_id', onDelete: 'CASCADE' });

// 13. Schedule <-> WaitingList (WaitingList.scheduleId 是 NOT NULL)
Schedule.hasMany(WaitingList, { foreignKey: 'schedule_id', onDelete: 'CASCADE' });
WaitingList.belongsTo(Schedule, { foreignKey: 'schedule_id', onDelete: 'CASCADE' });

// 14. WaitingList <-> Appointment (可选关系)
WaitingList.belongsTo(Appointment, { foreignKey: 'converted_to_appt_id', as: 'ConvertedAppointment' });

// 导出模型，同时确保命名一致性
module.exports = {
  sequelize,
  User,
  UserProfile,
  Department,
  Doctor,
  Schedule,
  Appointment,
  AuditLog,
  CallLog,
  AntiHoardingLog,
  SmsVerification,
  WaitingList
};