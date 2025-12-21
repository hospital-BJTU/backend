const { DataTypes } = require('sequelize');

// 定义UserProfile模型 - 对应 tb_user_profile 表
let UserProfile;

const UserProfileModel = {
  // 初始化模型
  initiate: (sequelize) => {
    UserProfile = sequelize.define('UserProfile', {
      profileId: {
        field: 'profile_id',
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '个人信息ID'
      },
      userId: {
        field: 'user_id',
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        comment: '关联 tb_user 的ID，外键且唯一'
      },
      realName: {
        field: 'real_name',
        type: DataTypes.STRING,
        allowNull: true,
        comment: '真实姓名'
      },
      gender: {
        field: 'gender',
        type: DataTypes.ENUM('male', 'female', 'other'),
        allowNull: true,
        comment: '性别: male(男), female(女), other(其他)'
      },
      birthDate: {
        field: 'birth_date',
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: '出生日期'
      },
      idCard: {
        field: 'id_card',
        type: DataTypes.STRING(18),
        allowNull: true,
        unique: true,
        comment: '身份证号码，唯一约束'
      },
      avatar: {
        field: 'avatar',
        type: DataTypes.STRING,
        allowNull: true,
        comment: '用户头像路径'
      },
      updatedAt: {
        field: 'updated_at',
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '更新时间'
      }
    }, {
      tableName: 'tb_user_profile',
      timestamps: false
    });

    return UserProfile;
  },
  // 获取UserProfile模型实例
  getModel: () => UserProfile
};

module.exports = UserProfileModel;