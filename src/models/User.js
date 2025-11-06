const { DataTypes } = require('sequelize');

// 定义User模型
let User;

const UserModel = {
  // 初始化模型
  initiate: (sequelize) => {
    User = sequelize.define('User', {
      userId: {
        field: 'user_id',
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '用户ID'
      },
      username: {
        field: 'username',
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: '用户名，唯一约束'
      },
      password: {
        field: 'password',
        type: DataTypes.STRING,
        allowNull: false,
        comment: '登录密码'
      },
      role: {
        field: 'role',
        type: DataTypes.ENUM('patient', 'doctor', 'admin'),
        allowNull: false,
        defaultValue: 'patient',
        comment: '用户角色: patient(患者), doctor(医生), admin(管理员)'
      },
      verifyStatus: {
        field: 'verify_status',
        type: DataTypes.ENUM('unverified', 'verified'),
        allowNull: false,
        defaultValue: 'unverified',
        comment: '核验状态: unverified(未核验), verified(已核验)'
      },
      phone: {
        field: 'phone',
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
        comment: '手机号码'
      },
      createdAt: {
        field: 'created_at',
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '创建时间'
      }
    }, {
      tableName: 'tb_user',
      timestamps: false // 禁用默认时间戳
    });
    return User;
  }
};

module.exports = UserModel;