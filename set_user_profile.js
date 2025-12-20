// 加载环境变量
require('dotenv').config();

// 使用项目现有的数据库配置
const db = require('./src/config/database');
const { User, UserProfile } = require('./src/models');

// 执行操作
async function setUserProfile() {
  try {
    // 检查用户是否存在
    const user = await User.findByPk(3014);
    if (!user) {
      console.log('用户ID 3014不存在');
      return;
    }

    // 设置要添加的用户信息
    const profileData = {
      userId: 3014,
      realName: '王五',
      idCard: '110101199001011235' // 用户指定的身份证号码
    };

    // 使用findOrCreate来创建或更新用户profile
    const [profile, created] = await UserProfile.findOrCreate({
      where: { userId: 3014 },
      defaults: profileData
    });

    if (created) {
      console.log('成功为用户3014创建profile信息');
    } else {
      // 更新现有profile
      await profile.update(profileData);
      console.log('成功更新用户3014的profile信息');
    }

    // 显示更新后的信息
    const updatedProfile = await UserProfile.findOne({ where: { userId: 3014 } });
    console.log('更新后的用户profile信息:', updatedProfile.dataValues);

  } catch (error) {
    console.error('操作失败:', error);
  }
}

// 执行函数
setUserProfile();