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

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 根据文件类型获取图标
function getFileIcon(fileType) {
  const iconMap = {
    'pdf': 'file-pdf',
    'doc': 'file-word',
    'docx': 'file-word',
    'xls': 'file-excel',
    'xlsx': 'file-excel',
    'ppt': 'file-powerpoint',
    'pptx': 'file-powerpoint',
    'jpg': 'file-image',
    'jpeg': 'file-image',
    'png': 'file-image',
    'gif': 'file-image',
    'zip': 'file-zip',
    'rar': 'file-zip',
    'mp4': 'video',
    'mp3': 'sound',
    'txt': 'file'
  };
  return iconMap[fileType?.toLowerCase()] || 'file';
}

// 根据文件类型获取图标颜色
function getFileIconColor(fileType) {
  const colorMap = {
    'pdf': '#E53935',       // PDF - 红色
    'doc': '#1976D2',       // Word - 蓝色
    'docx': '#1976D2',
    'xls': '#388E3C',       // Excel - 绿色
    'xlsx': '#388E3C',
    'ppt': '#E65100',       // PPT - 橙色
    'pptx': '#E65100',
    'jpg': '#7B1FA2',       // 图片 - 紫色
    'jpeg': '#7B1FA2',
    'png': '#7B1FA2',
    'gif': '#7B1FA2',
    'zip': '#795548',       // 压缩包 - 棕色
    'rar': '#795548',
    'mp4': '#D32F2F',       // 视频 - 深红色
    'mp3': '#00ACC1',       // 音频 - 青色
    'txt': '#607D8B'        // 文本 - 灰色
  };
  return colorMap[fileType?.toLowerCase()] || '#0052d9';
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

Page({
  data: {
    isLoggedIn: false,
    classId: '',
    resourceList: [],
    loading: false,
    refreshing: false
  },

  onLoad() {
    this.checkLoginAndLoadData();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(2);
    }
    // 每次显示时重新检查登录状态并加载数据
    this.checkLoginAndLoadData();
  },

  // 检查登录状态并加载数据
  checkLoginAndLoadData() {
    const token = wx.getStorageSync('token');
    if (token) {
      const payload = parseJwt(token);
      if (payload && payload.classId) {
        this.setData({
          isLoggedIn: true,
          classId: payload.classId
        });
        this.loadResourceList();
      } else {
        this.setData({
          isLoggedIn: !!payload,
          classId: '',
          resourceList: []
        });
      }
    } else {
      this.setData({
        isLoggedIn: false,
        classId: '',
        resourceList: []
      });
    }
  },

  // 加载资源列表
  async loadResourceList() {
    const { classId } = this.data;
    if (!classId) return;

    this.setData({ loading: true });

    try {
      const res = await get(`/GetResourceList?classId=${classId}`);
      
      if (res.code === 1) {
        // 处理资源数据，添加显示所需的格式化字段
        const resourceList = (res.data || []).map(item => ({
          ...item,
          fileSizeText: formatFileSize(item.fileSize),
          fileIcon: getFileIcon(item.fileType),
          fileIconColor: getFileIconColor(item.fileType),
          uploadTimeText: formatTime(item.uploadTime)
        }));
        
        this.setData({ resourceList });
      } else {
        Toast({
          context: this,
          selector: '#t-toast',
          message: res.msg || '获取资源列表失败'
        });
      }
    } catch (err) {
      console.error('加载资源列表失败:', err);
      Toast({
        context: this,
        selector: '#t-toast',
        message: '网络错误，请稍后重试'
      });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  // 下拉刷新
  onRefresh() {
    this.setData({ refreshing: true });
    this.loadResourceList();
  },

  // 下载文件
  handleDownload(e) {
    const { fileUrl, fileName } = e.currentTarget.dataset;
    
    if (!fileUrl) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '文件地址无效'
      });
      return;
    }

    // 补全 URL：后端可能返回相对路径（如 /uploads/file.pdf），downloadFile 需要完整 URL
    let fullUrl = fileUrl;
    if (!/^https?:\/\//i.test(fullUrl)) {
      // 从 app.js 的 baseUrl 中提取协议+域名+端口
      const baseUrl = getApp().globalData.baseUrl || 'https://106.52.162.142:8443/dm-api';
      // 去掉 /dm-api 后缀，只保留 https://106.52.162.142:8443
      const hostMatch = baseUrl.match(/^(https?:\/\/[^/]+)/i);
      const host = hostMatch ? hostMatch[1] : 'https://106.52.162.142:8443';
      // 确保相对路径以 / 开头
      if (!fullUrl.startsWith('/')) {
        fullUrl = '/' + fullUrl;
      }
      fullUrl = host + fullUrl;
    }

    wx.showLoading({ title: '下载中...' });

    // 使用 wx.downloadFile 下载文件
    wx.downloadFile({
      url: fullUrl,
      success: (res) => {
        wx.hideLoading();
        
        if (res.statusCode === 200) {
          const filePath = res.tempFilePath;
          
          // 打开文件
          wx.openDocument({
            filePath: filePath,
            showMenu: true, // 显示右上角菜单，可以转发、保存等
            success: () => {
              console.log('文件打开成功');
            },
            fail: (err) => {
              console.error('文件打开失败:', err);
              // 如果无法打开，提示用户保存到本地
              wx.showModal({
                title: '提示',
                content: '无法直接打开此文件，是否保存到本地？',
                success: (modalRes) => {
                  if (modalRes.confirm) {
                    wx.saveFile({
                      tempFilePath: filePath,
                      success: (saveRes) => {
                        Toast({
                          context: this,
                          selector: '#t-toast',
                          message: '文件已保存',
                          theme: 'success'
                        });
                      },
                      fail: () => {
                        Toast({
                          context: this,
                          selector: '#t-toast',
                          message: '保存失败'
                        });
                      }
                    });
                  }
                }
              });
            }
          });
        } else {
          Toast({
            context: this,
            selector: '#t-toast',
            message: '下载失败'
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('下载失败:', err);
        Toast({
          context: this,
          selector: '#t-toast',
          message: '下载失败，请稍后重试'
        });
      }
    });
  },

  // 跳转到登录页
  goToLogin() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  }
});