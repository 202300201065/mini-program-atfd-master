const { get } = require('../../utils/request');
import Toast from 'tdesign-miniprogram/toast/index';

// 解析 JWT Token（小程序兼容版）
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    
    // 替换 URL 安全的 Base64 字符
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // 补全 Base64 填充符
    const paddedBase64 = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    
    // 小程序兼容的 Base64 解码
    const buffer = wx.base64ToArrayBuffer(paddedBase64);
    const jsonPayload = decodeURIComponent(
      Array.from(new Uint8Array(buffer))
        .map(c => '%' + ('00' + c.toString(16)).slice(-2))
        .join('')
    );
    
    return JSON.parse(jsonPayload);
  } catch (e) {
    console.error('JWT解析失败:', e);
    return null;
  }
}

// 格式化时间
function formatTime(timeStr) {
  if (!timeStr) return '';
  const date = new Date(timeStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

// 获取练习状态
// isCompleted: 是否已完成所有题目
function getPracticeStatus(endTime, isCompleted) {
  const now = new Date();
  const end = endTime ? new Date(endTime) : null;
  const isEnded = end && now > end;
  const isNearDeadline = end && !isEnded && (end - now) < 24 * 60 * 60 * 1000; // 24小时内

  if (isCompleted) {
    return { text: '已完成', color: '#52c41a', status: 'completed' };
  }
  if (isEnded) {
    return { text: '未完成', color: '#999', status: 'incomplete' };
  }
  if (isNearDeadline) {
    return { text: '即将截止', color: '#ff4d4f', status: 'deadline' };
  }
  return { text: '进行中', color: '#52c41a', status: 'ongoing' };
}

Page({
  data: {
    isLoggedIn: false,
    classId: '',
    practiceList: [],
    loading: false,
    refreshing: false
  },

  onLoad() {
    this.checkLoginAndLoadData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(1);
    }
    // 每次显示时重新检查登录状态并加载数据
    this.checkLoginAndLoadData();
  },

  // 检查登录状态并加载数据
  async checkLoginAndLoadData() {
    const token = wx.getStorageSync('token');
    if (token) {
      let payload = parseJwt(token);
      if (payload) {
        // 已登录但 token 中缺少 classId，尝试从服务端获取最新信息
        if (!payload.classId) {
          try {
            const refreshRes = await get('/getMyProfile');
            if (refreshRes.code === 1 && refreshRes.data) {
              wx.setStorageSync('token', refreshRes.data);
              payload = parseJwt(refreshRes.data) || payload;
            }
          } catch (err) {
            console.error('获取用户信息失败:', err);
          }
        }

        if (payload.classId) {
          this.setData({
            isLoggedIn: true,
            classId: payload.classId
          });
          this.loadPracticeList();
        } else {
          this.setData({
            isLoggedIn: true,
            classId: '',
            practiceList: []
          });
        }
      }  
    } else {
      this.setData({
        isLoggedIn: false,
        classId: '',
        practiceList: []
      });
    }
  },

  // 加载练习列表
  async loadPracticeList() {
    const { classId } = this.data;
    if (!classId) return;

    this.setData({ loading: true });

    try {
      const res = await get(`/practice?classId=${classId}`);
      
      if (res.code === 1) {
        // 处理练习数据，添加显示所需的格式化字段
        const practiceList = (res.data || []).map(item => {
          const questionIds = item.questionIds || item.questionIdList || [];
          // 初始状态，待完成状态检查后更新
          const status = getPracticeStatus(item.endTime, false);
          return {
            ...item,
            createTimeText: formatTime(item.createTime),
            endTimeText: formatTime(item.endTime),
            statusText: status.text,
            statusColor: status.color,
            statusType: status.status,
            // 将题目ID列表转为JSON字符串以便通过dataset传递
            questionIdListStr: JSON.stringify(questionIds),
            // 完成状态
            isCompleted: false,
            completedCount: 0,
            totalCount: questionIds.length
          };
        });
        
        this.setData({ practiceList });
        
        // 异步检查每个练习的完成状态
        this.checkPracticeCompletion(practiceList);
      } else {
        Toast({
          context: this,
          selector: '#t-toast',
          message: res.msg || '获取练习列表失败'
        });
      }
    } catch (err) {
      console.error('加载练习列表失败:', err);
      Toast({
        context: this,
        selector: '#t-toast',
        message: '网络错误，请稍后重试'
      });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  // 检查练习完成状态
  async checkPracticeCompletion(practiceList) {
    // 并行请求每个练习的答题记录
    const promises = practiceList.map(async (practice, index) => {
      try {
        // 获取当前练习的题目ID列表
        const questionIds = practice.questionIds || practice.questionIdList || [];
        const questionIdsParam = questionIds.join(',');
        const res = await get(`/answerRecords/list?practiceId=${practice.id}&questionIds=${questionIdsParam}`);
        if (res.code === 1 && res.data) {
          const completedCount = res.data.length;
          const totalCount = practice.totalCount;
          const isCompleted = totalCount > 0 && completedCount >= totalCount;
          
          return { index, completedCount, isCompleted, endTime: practice.endTime };
        }
      } catch (err) {
        console.error(`检查练习${practice.id}完成状态失败:`, err);
      }
      return null;
    });

    const results = await Promise.all(promises);
    
    // 更新练习列表的完成状态
    const { practiceList: currentList } = this.data;
    let hasUpdate = false;
    
    results.forEach(result => {
      if (result && currentList[result.index]) {
        const practice = currentList[result.index];
        practice.completedCount = result.completedCount;
        practice.isCompleted = result.isCompleted;
        
        // 重新计算状态（基于完成情况）
        const status = getPracticeStatus(result.endTime, result.isCompleted);
        practice.statusText = status.text;
        practice.statusColor = status.color;
        practice.statusType = status.status;
        
        hasUpdate = true;
      }
    });
    
    if (hasUpdate) {
      this.setData({ practiceList: currentList });
    }
  },

  // 下拉刷新
  onRefresh() {
    this.setData({ refreshing: true });
    this.loadPracticeList();
  },

  // 点击练习项
  handlePracticeClick(e) {
    const { id, name, questionids, endtime } = e.currentTarget.dataset;
    
    // 解析JSON字符串
    let questionIdList = [];
    try {
      questionIdList = JSON.parse(questionids || '[]');
    } catch (err) {
      console.error('解析题目ID列表失败:', err);
    }
    
    if (!questionIdList || questionIdList.length === 0) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '该练习暂无题目'
      });
      return;
    }
    // 跳转到练习详情页
    wx.navigateTo({
      url: `/pages/practiceDetail/practiceDetail?id=${id}&name=${encodeURIComponent(name)}&questionIds=${encodeURIComponent(JSON.stringify(questionIdList))}&endTime=${encodeURIComponent(endtime || '')}`
    });
  },

  // 跳转到登录页
  goToLogin() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  }
});