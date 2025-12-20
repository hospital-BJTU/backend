const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// 加载环境变量
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// 直接从models/index.js导入所有已初始化的模型
const { User, UserProfile, Doctor, Schedule, Appointment } = require('./src/models');

// 创建测试数据的函数
async function createTestData() {
    try {
        console.log('开始创建测试数据...');

        // 获取当前日期
        const today = new Date();
        const todayFormatted = today.toISOString().split('T')[0];

        // 1. 创建或获取测试用户
        let testUser = await User.findOne({
            where: { username: 'test_patient' }
        });

        if (!testUser) {
            // 检查是否有现有患者
            const existingPatient = await User.findOne({
                where: {
                    role: 'patient',
                    verifyStatus: 'verified',
                    accountStatus: 'active'
                }
            });

            if (existingPatient) {
                testUser = existingPatient;
                console.log('使用现有患者用户');
            } else {
                // 创建新测试用户
                testUser = await User.create({
                    username: 'test_patient',
                    password: '12345678',
                    phone: '13800138001',  // 确保设置phone字段
                    role: 'patient',
                    verifyStatus: 'verified',
                    accountStatus: 'active'
                });
                console.log('创建测试用户成功');
            }
        } else {
            console.log('测试用户已存在');
        }

        console.log('测试用户:', testUser.toJSON());

        // 2. 创建或获取用户档案
        let userProfile = await UserProfile.findOne({
            where: { userId: testUser.userId }
        });

        if (!userProfile) {
            // 检查是否有现有重复的身份证号
            const testIdCard = '110101199001011234';
            const existingProfile = await UserProfile.findOne({
                where: { idCard: testIdCard }
            });

            // 如果身份证号已存在，生成一个新的唯一身份证号
            const idCardToUse = existingProfile ? `11010119900101${Math.floor(1000 + Math.random() * 9000)}` : testIdCard;

            userProfile = await UserProfile.create({
                userId: testUser.userId,
                realName: '测试患者',
                idCard: idCardToUse,
                phoneNumber: '13800138001',
                gender: 'male',
                age: 30
            });
            console.log('创建用户档案成功');
        } else {
            console.log('用户档案已存在');
        }

        console.log('用户档案:', userProfile.toJSON());

        // 3. 获取一个医生
        let doctor = await Doctor.findOne();

        if (!doctor) {
            // 创建医生用户
            const doctorUser = await User.create({
                username: 'test_doctor',
                password: '12345678',
                phone: '13800138002',
                role: 'doctor',
                verifyStatus: 'verified',
                accountStatus: 'active'
            });

            // 创建医生信息
            doctor = await Doctor.create({
                userId: doctorUser.userId,
                departmentId: 1,
                title: '主治医师'
            });
            console.log('创建测试医生成功');
        } else {
            console.log('使用现有医生');
        }

        console.log('医生:', doctor.toJSON());

        // 4. 创建今天的排班
        let schedule = await Schedule.findOne({
            where: {
                doctorId: doctor.doctorId,
                scheduleDate: todayFormatted
            }
        });

        if (!schedule) {
            schedule = await Schedule.create({
                doctorId: doctor.doctorId,
                scheduleDate: todayFormatted,
                timeSlot: '14:00-15:00',
                maxCount: 10,
                availableCount: 5,
                auditStatus: 'approved'
            });
            console.log('创建今天的排班成功');
        } else {
            console.log('今天的排班已存在');
        }

        console.log('排班:', schedule.toJSON());

        // 5. 创建今天的预约
        const count = await Appointment.count({
            where: {
                scheduleId: schedule.scheduleId,
                scheduleDate: todayFormatted
            }
        });

        const appointment = await Appointment.create({
            userId: testUser.userId,
            scheduleId: schedule.scheduleId,
            serialNumber: count + 1,
            scheduleDate: todayFormatted,
            status: 'pending',
            checkInStatus: 'not_checked',
            isValid: true
        });

        console.log('创建预约成功');
        console.log('预约:', appointment.toJSON());

        console.log('\n测试数据创建成功!');
        console.log('\n可以使用以下信息进行签到测试:');
        console.log('患者姓名:', userProfile.realName);
        console.log('身份证号:', userProfile.idCard);
        console.log('预约ID:', appointment.apptId);
        console.log('序列号:', appointment.serialNumber);
        console.log('签到状态:', appointment.checkInStatus);

    } catch (error) {
        console.error('创建测试数据时出错:', error);
        if (error.name === 'SequelizeValidationError') {
            console.error('验证错误详情:', error.errors);
        }
    }
}

// 执行函数
createTestData();