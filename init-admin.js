const { User, Doctor, Department } = require('./src/models');
const bcrypt = require('bcrypt');

// 初始化管理员账号
async function initAdmin() {
  try {
    console.log('开始初始化管理员账号...');
    
    // 检查是否已存在管理员账号
    const adminExists = await User.findOne({ where: { role: 'admin' } });
    if (adminExists) {
      console.log('管理员账号已存在:', adminExists.username);
      console.log('ID:', adminExists.userId);
      console.log('请使用用户名: admin 和密码: admin123 进行登录');
      return;
    }
    
    // 获取最大ID
    const maxUserIdResult = await User.max('userId');
    const newUserId = maxUserIdResult ? maxUserIdResult + 1 : 1;
    
    // 创建管理员账号
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const admin = await User.create({
      userId: newUserId,
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      phone: '13800000000',
      verifyStatus: 'verified'
    });
    
    console.log('管理员账号创建成功:');
    console.log('用户名: admin');
    console.log('密码: admin123');
    console.log('角色: admin');
    console.log('用户ID:', admin.user_id);
    
  } catch (error) {
    console.error('初始化管理员账号失败:', error);
  }
}

// 初始化示例部门
async function initDepartments() {
  try {
    console.log('开始初始化部门数据...');
    
    // 检查是否已有部门
    const deptCount = await Department.count();
    if (deptCount > 0) {
      console.log('部门数据已存在，跳过初始化');
      return;
    }
    
    // 创建示例部门
    const departments = [
      { dept_name: '内科', description: '内科部门' },
      { dept_name: '外科', description: '外科部门' },
      { dept_name: '儿科', description: '儿科部门' },
      { dept_name: '妇科', description: '妇科部门' },
      { dept_name: '眼科', description: '眼科部门' },
      { dept_name: '口腔科', description: '口腔科部门' }
    ];
    
    await Department.bulkCreate(departments);
    console.log('部门数据初始化成功');
  } catch (error) {
    console.error('初始化部门数据失败:', error);
  }
}

// 主函数
async function main() {
  await initDepartments();
  await initAdmin();
  console.log('初始化完成');
  process.exit(0);
}

main();