const { post, get, uploadFile } = require('../../utils/request');
import Toast from 'tdesign-miniprogram/toast/index';

// 解析 JWT Token（小程序兼容版，替换原有 atob 实现）
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    
    // 替换 URL 安全的 Base64 字符
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    // 补全 Base64 填充符（避免解码失败）
    const paddedBase64 = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    
    // 小程序兼容的 Base64 解码（替代 atob）
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

Page({
  data: {
    isLoggedIn: false,      // 是否已登录
    userInfo: {             // 用户信息
      email: '',
      username: '',
      cardId: '',
      avatar: '',
      classId: '',
      className: ''         // 班级名称
    },
    pageMode: 'login',      // login | register | reset
    loginType: 'password',  // password | code
    email: '',
    password: '',
    confirmPassword: '',
    verifyCode: '',
    countdown: 0,
    loading: false
  },

  onLoad() {
    this.checkLoginStatus();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(0);
    }
    // 每次显示时重新检查登录状态
    this.checkLoginStatus();
  },

  // 检查登录状态
  async checkLoginStatus() {
    const token = wx.getStorageSync('token');
    if (token) {
      const payload = parseJwt(token);
      console.log('Token payload:', payload); // 调试：查看 Token 中的字段
      if (payload) {
        const userInfo = {
          email: payload.email || '',
          username: payload.username || '未设置昵称',
          cardId: payload.cardId || '',
          avatar: payload.avatar || '',
          classId: payload.classId || '',
          className: ''
        };
        
        // 如果有班级ID，获取班级名称
        if (payload.classId) {
          // 先从缓存读取班级名称
          const cachedClassName = wx.getStorageSync('className');
          if (cachedClassName) {
            userInfo.className = cachedClassName;
          }
          
          // 异步获取最新班级名称
          try {
            const res = await get('/ClassInfo', { classId: payload.classId });
            if (res.code === 1 && res.data && res.data.className) {
              userInfo.className = res.data.className;
              // 缓存班级名称
              wx.setStorageSync('className', res.data.className);
            }
          } catch (err) {
            console.error('获取班级信息失败:', err);
          }
        } else {
          // 没有班级ID，清除缓存
          wx.removeStorageSync('className');
        }
        
        this.setData({
          isLoggedIn: true,
          userInfo
        });
      } else {
        // Token 解析失败，清除无效 token
        wx.removeStorageSync('token');
        this.setData({ isLoggedIn: false });
      }
    } else {
      this.setData({ isLoggedIn: false });
    }
  },

  // 退出登录
  handleLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('token');
          wx.removeStorageSync('className');
          this.setData({
            isLoggedIn: false,
            userInfo: {
              email: '',
              username: '',
              cardId: '',
              avatar: '',
              classId: '',
              className: ''
            },
            pageMode: 'login'
          });
          Toast({
            context: this,
            selector: '#t-toast',
            message: '已退出登录'
          });
        }
      }
    });
  },

  // ========== 个人信息修改功能 ==========

  // 修改头像
  handleChangeAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        
        wx.showLoading({ title: '上传中...' });
        
        try {
          const result = await uploadFile('/updateAvatar', tempFilePath, {
            email: this.data.userInfo.email
          });
          
          wx.hideLoading();
          
          if (result.code === 1) {
            // 保存新 Token
            wx.setStorageSync('token', result.data);
            Toast({
              context: this,
              selector: '#t-toast',
              message: '头像修改成功',
              theme: 'success'
            });
            // 刷新用户信息
            this.checkLoginStatus();
          } else {
            Toast({
              context: this,
              selector: '#t-toast',
              message: result.msg || '上传失败'
            });
          }
        } catch (err) {
          wx.hideLoading();
          Toast({
            context: this,
            selector: '#t-toast',
            message: '网络错误，请稍后重试'
          });
        }
      }
    });
  },

  // 修改昵称
  handleChangeUsername() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      success: async (res) => {
        if (res.confirm && res.content) {
          const newUsername = res.content.trim();
          if (!newUsername) {
            Toast({
              context: this,
              selector: '#t-toast',
              message: '昵称不能为空'
            });
            return;
          }
          
          wx.showLoading({ title: '修改中...' });
          
          try {
            const result = await post('/updateUsername', {
              email: this.data.userInfo.email,
              username: newUsername
            });
            
            wx.hideLoading();
            
            if (result.code === 1) {
              // 保存新 Token
              wx.setStorageSync('token', result.data);
              Toast({
                context: this,
                selector: '#t-toast',
                message: '昵称修改成功',
                theme: 'success'
              });
              // 刷新用户信息
              this.checkLoginStatus();
            } else {
              Toast({
                context: this,
                selector: '#t-toast',
                message: result.msg || '修改失败'
              });
            }
          } catch (err) {
            wx.hideLoading();
            Toast({
              context: this,
              selector: '#t-toast',
              message: '网络错误，请稍后重试'
            });
          }
        }
      }
    });
  },

  // 绑定学号
  handleBindCardId() {
    wx.showModal({
      title: '绑定学号',
      editable: true,
      placeholderText: '请输入学号',
      success: async (res) => {
        if (res.confirm && res.content) {
          const cardId = res.content.trim();
          if (!cardId) {
            Toast({
              context: this,
              selector: '#t-toast',
              message: '学号不能为空'
            });
            return;
          }
          
          wx.showLoading({ title: '绑定中...' });
          
          try {
            const result = await post('/bindCardId', {
              email: this.data.userInfo.email,
              cardId: cardId
            });
            
            wx.hideLoading();
            
            if (result.code === 1) {
              // 保存新 Token
              wx.setStorageSync('token', result.data);
              Toast({
                context: this,
                selector: '#t-toast',
                message: '学号绑定成功',
                theme: 'success'
              });
              // 刷新用户信息
              this.checkLoginStatus();
            } else {
              Toast({
                context: this,
                selector: '#t-toast',
                message: result.msg || '绑定失败'
              });
            }
          } catch (err) {
            wx.hideLoading();
            Toast({
              context: this,
              selector: '#t-toast',
              message: '网络错误，请稍后重试'
            });
          }
        }
      }
    });
  },

  // 加入/修改班级
  handleJoinClass() {
    const hasClass = !!this.data.userInfo.classId;
    const title = hasClass ? '修改班级' : '加入班级';
    const successMsg = hasClass ? '班级修改成功' : '加入班级成功';
    const loadingMsg = hasClass ? '修改中...' : '加入中...';
    
    wx.showModal({
      title: title,
      editable: true,
      placeholderText: '请输入班级邀请码',
      success: async (res) => {
        if (res.confirm && res.content) {
          const accessCode = res.content.trim();
          if (!accessCode) {
            Toast({
              context: this,
              selector: '#t-toast',
              message: '邀请码不能为空'
            });
            return;
          }
          
          wx.showLoading({ title: loadingMsg });
          
          try {
            // accessCode 作为 Query 参数
            const result = await post(`/JoinClassByAccessCode?accessCode=${encodeURIComponent(accessCode)}`, {});
            
            wx.hideLoading();
            
            if (result.code === 1) {
              // 保存新 Token
              wx.setStorageSync('token', result.data);
              Toast({
                context: this,
                selector: '#t-toast',
                message: successMsg,
                theme: 'success'
              });
              // 刷新用户信息（从新 Token 解析 classId）
              this.checkLoginStatus();
            } else {
              Toast({
                context: this,
                selector: '#t-toast',
                message: result.msg || '操作失败'
              });
            }
          } catch (err) {
            wx.hideLoading();
            Toast({
              context: this,
              selector: '#t-toast',
              message: '网络错误，请稍后重试'
            });
          }
        }
      }
    });
  },

  // 切换登录方式
  switchLoginType(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      loginType: type,
      password: '',
      verifyCode: ''
    });
  },

  // 邮箱输入事件（原 onPhoneChange）
  onEmailChange(e) {
    this.setData({ email: e.detail.value });
  },

  onPasswordChange(e) {
    this.setData({ password: e.detail.value });
  },

  onConfirmPasswordChange(e) {
    this.setData({ confirmPassword: e.detail.value });
  },

  onCodeChange(e) {
    this.setData({ verifyCode: e.detail.value });
  },

  // 验证邮箱（原验证手机号）
  validateEmail() {
    const { email } = this.data;
    if (!email) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请输入邮箱'
      });
      return false;
    }
    // 邮箱正则
    const emailReg = /^[a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+\.[a-zA-Z]{2,}$/;
    if (!emailReg.test(email)) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请输入正确的邮箱'
      });
      return false;
    }
    return true;
  },

  // 发送验证码
  async sendCode() {
    if (this.data.countdown > 0) return;
    if (!this.validateEmail()) return;

    try {
      const res = await post('/sendCode', {
        email: this.data.email
      });

      if (res.code === 1) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '验证码已发送'
        });
        // 开始倒计时
        this.startCountdown();
      } else {
        Toast({
          context: this,
          selector: '#t-toast',
          message: res.msg || '发送失败'
        });
      }
    } catch (err) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '网络错误，请稍后重试'
      });
    }
  },

  // 倒计时
  startCountdown() {
    this.setData({ countdown: 60 });
    this.timer = setInterval(() => {
      if (this.data.countdown <= 1) {
        clearInterval(this.timer);
        this.setData({ countdown: 0 });
      } else {
        this.setData({ countdown: this.data.countdown - 1 });
      }
    }, 1000);
  },

  // 登录
  async handleLogin() {
    if (!this.validateEmail()) return;

    const { loginType, email, password, verifyCode } = this.data;

    if (loginType === 'password' && !password) {
      Toast({ context: this, selector: '#t-toast', message: '请输入密码' });
      return;
    }

    if (loginType === 'code' && !verifyCode) {
      Toast({ context: this, selector: '#t-toast', message: '请输入验证码' });
      return;
    }

    this.setData({ loading: true });

    try {
      const params = { email };
      if (loginType === 'password') {
        params.password = password;
      } else {
        params.verifyCode = verifyCode;
      }

      const res = await post('/login/student', params);

      if (res.code === 1) {
        // 保存 token
        wx.setStorageSync('token', res.data);
        Toast({
          context: this,
          selector: '#t-toast',
          message: '登录成功',
          theme: 'success'
        });
        // 刷新登录状态，显示个人信息
        setTimeout(() => {
          this.checkLoginStatus();
        }, 1000);
      } else {
        Toast({ context: this, selector: '#t-toast', message: res.msg || '登录失败' });
      }
    } catch (err) {
      Toast({ context: this, selector: '#t-toast', message: '网络错误，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 注册
  async handleRegister() {
    if (!this.validateEmail()) return;

    const { email, verifyCode, password, confirmPassword } = this.data;

    if (!verifyCode) {
      Toast({ context: this, selector: '#t-toast', message: '请输入验证码' });
      return;
    }

    if (!password) {
      Toast({ context: this, selector: '#t-toast', message: '请设置密码' });
      return;
    }

    if (password.length < 6) {
      Toast({ context: this, selector: '#t-toast', message: '密码至少6位' });
      return;
    }

    if (password !== confirmPassword) {
      Toast({ context: this, selector: '#t-toast', message: '两次密码不一致' });
      return;
    }

    this.setData({ loading: true });

    try {
      const res = await post('/register/student', {
        email,
        verifyCode,
        password
      });

      if (res.code === 1) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '注册成功',
          theme: 'success'
        });
        // 跳转到登录页
        setTimeout(() => {
          this.goToLogin();
        }, 1500);
      } else {
        Toast({ context: this, selector: '#t-toast', message: res.msg || '注册失败' });
      }
    } catch (err) {
      Toast({ context: this, selector: '#t-toast', message: '网络错误，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 重置密码
  async handleReset() {
    if (!this.validateEmail()) return;

    const { email, verifyCode, password, confirmPassword } = this.data;

    if (!verifyCode) {
      Toast({ context: this, selector: '#t-toast', message: '请输入验证码' });
      return;
    }

    if (!password) {
      Toast({ context: this, selector: '#t-toast', message: '请设置新密码' });
      return;
    }

    if (password.length < 6) {
      Toast({ context: this, selector: '#t-toast', message: '密码至少6位' });
      return;
    }

    if (password !== confirmPassword) {
      Toast({ context: this, selector: '#t-toast', message: '两次密码不一致' });
      return;
    }

    this.setData({ loading: true });

    try {
      const res = await post('/resetPassword', {
        email,
        verifyCode,
        password
      });

      if (res.code === 1) {
        Toast({
          context: this,
          selector: '#t-toast',
          message: '密码重置成功',
          theme: 'success'
        });
        // 跳转到登录页
        setTimeout(() => {
          this.goToLogin();
        }, 1500);
      } else {
        Toast({ context: this, selector: '#t-toast', message: res.msg || '重置失败' });
      }
    } catch (err) {
      Toast({ context: this, selector: '#t-toast', message: '网络错误，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 页面切换
  goToLogin() {
    this.setData({
      pageMode: 'login',
      password: '',
      confirmPassword: '',
      verifyCode: ''
    });
  },

  goToRegister() {
    this.setData({
      pageMode: 'register',
      password: '',
      confirmPassword: '',
      verifyCode: ''
    });
  },

  goToReset() {
    this.setData({
      pageMode: 'reset',
      password: '',
      confirmPassword: '',
      verifyCode: ''
    });
  },

  onUnload() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
});