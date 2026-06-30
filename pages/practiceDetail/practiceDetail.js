// practiceDetail.js
const { get, post } = require('../../utils/request');
import Toast from 'tdesign-miniprogram/toast/index';

Page({
  data: {
    practiceId: null,
    practiceName: '',
    questionIdList: [],
    currentIndex: 0,
    currentQuestion: null,
    loading: false,
    submitting: false,
    // 答题记录 Map: questionId -> record
    answerRecords: {},
    // 当前题目的用户答案
    userAnswer: null,
    // 多选题选中的选项
    multipleSelected: [],
    // 多选题选中状态Map
    multipleSelectedMap: {},
    // 填空题答案数组
    fillAnswers: [],
    // 截止时间
    endTime: null,
    // 是否已截止
    isEnded: false
  },

  onLoad(options) {
    const { id, name, questionIds, endTime } = options;
    if (id && questionIds) {
      const questionIdList = JSON.parse(decodeURIComponent(questionIds));
      const decodedEndTime = endTime ? decodeURIComponent(endTime) : null;
      const isEnded = decodedEndTime ? new Date() > new Date(decodedEndTime) : false;
      
      this.setData({
        practiceId: parseInt(id),
        practiceName: decodeURIComponent(name || '练习详情'),
        questionIdList,
        endTime: decodedEndTime,
        isEnded
      });
      // 先加载答题记录，再加载第一道题
      this.loadAnswerRecords();
    } else {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '参数错误'
      });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  // 加载答题记录
  async loadAnswerRecords() {
    const { practiceId, questionIdList } = this.data;
    try {
      // 传递questionIds参数，过滤当前练习中实际存在的题目的答题记录
      const questionIdsParam = questionIdList.join(',');
      const res = await get(`/answerRecords/list?practiceId=${practiceId}&questionIds=${questionIdsParam}`);
      if (res.code === 1 && res.data) {
        // 将答题记录转换为 Map
        const answerRecords = {};
        res.data.forEach(record => {
          answerRecords[record.questionId] = record;
        });
        this.setData({ answerRecords });
      }
    } catch (err) {
      console.error('加载答题记录失败:', err);
    }
    // 加载第一道题
    this.loadQuestion(0);
  },

  // 加载指定索引的题目
  async loadQuestion(index) {
    const { questionIdList } = this.data;
    if (index < 0 || index >= questionIdList.length) return;

    const questionId = questionIdList[index];
    this.setData({ 
      loading: true, 
      currentIndex: index,
      userAnswer: null,
      multipleSelected: [],
      multipleSelectedMap: {},
      fillAnswers: []
    });

    try {
      const res = await get(`/questions/${questionId}`);
      if (res.code === 1 && res.data) {
        const question = this.processQuestion(res.data);
        this.setData({ 
          currentQuestion: question,
          loading: false
        });
        // 如果已提交，恢复答案显示
        this.restoreSubmittedAnswer(questionId);
      } else {
        Toast({
          context: this,
          selector: '#t-toast',
          message: res.msg || '加载题目失败'
        });
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error('加载题目失败:', err);
      Toast({
        context: this,
        selector: '#t-toast',
        message: '网络错误'
      });
      this.setData({ loading: false });
    }
  },

  // 处理题目数据
  processQuestion(data) {
    // 防御：后端返回的题目数据可能缺少 info 或 detail 字段
    if (!data) {
      console.warn('题目数据为空');
      return { id: 0, type: 'unknown', content: '题目数据异常', tags: [], analysis: '' };
    }
    const { info = {}, detail = {}, tags } = data;
    const question = {
      id: detail.questionId || 0,
      type: info.type || 'unknown',
      content: info.content || '暂无题目内容',
      tags: tags || [],
      analysis: detail.analysis || ''
    };

    // 根据题型处理选项和答案
    switch (info.type) {
      case 'single':
        question.options = detail.optionlist || [];
        question.correctAnswer = detail.correctOption;
        break;
      case 'multiple':
        question.options = detail.optionlist || [];
        question.correctAnswers = detail.correctOptionlist || [];
        // 创建Map以便在wxml中判断
        question.correctAnswersMap = {};
        (detail.correctOptionlist || []).forEach(id => {
          question.correctAnswersMap[id] = true;
        });
        break;
      case 'true_false':
        question.correctAnswer = detail.correctAnswer;
        break;
      case 'fill':
        question.correctAnswers = detail.correctAnswerlist || [];
        // 计算填空数量
        question.blankCount = question.correctAnswers.length;
        break;
    }

    return question;
  },

  // 恢复已提交的答案显示
  restoreSubmittedAnswer(questionId) {
    const { answerRecords, currentQuestion } = this.data;
    const record = answerRecords[questionId];
    if (!record || !currentQuestion) return;

    const type = currentQuestion.type;
    let studentAnswer = record.studentAnswer;

    switch (type) {
      case 'single':
        this.setData({ userAnswer: studentAnswer });
        break;
      case 'multiple':
        try {
          const selected = JSON.parse(studentAnswer);
          const selectedMap = {};
          selected.forEach(id => { selectedMap[id] = true; });
          this.setData({ 
            multipleSelected: selected,
            multipleSelectedMap: selectedMap
          });
        } catch (e) {}
        break;
      case 'true_false':
        this.setData({ userAnswer: studentAnswer });
        break;
      case 'fill':
        try {
          const answers = JSON.parse(studentAnswer);
          this.setData({ fillAnswers: answers });
        } catch (e) {}
        break;
    }
  },

  // 获取题型显示名称
  getTypeName(type) {
    const typeMap = {
      'single': '单选题',
      'multiple': '多选题',
      'true_false': '判断题',
      'fill': '填空题'
    };
    return typeMap[type] || '题目';
  },

  // 检查当前题目是否已提交
  isCurrentSubmitted() {
    const { questionIdList, currentIndex, answerRecords } = this.data;
    const questionId = questionIdList[currentIndex];
    return !!answerRecords[questionId];
  },

  // 单选题选择
  onSingleSelect(e) {
    if (this.isCurrentSubmitted()) return;
    const { option } = e.currentTarget.dataset;
    this.setData({ userAnswer: option });
  },

  // 多选题选择
  onMultipleSelect(e) {
    if (this.isCurrentSubmitted()) return;
    const { option } = e.currentTarget.dataset;
    let { multipleSelected, multipleSelectedMap } = this.data;
    
    if (multipleSelectedMap[option]) {
      // 取消选择
      const index = multipleSelected.indexOf(option);
      if (index > -1) {
        multipleSelected.splice(index, 1);
      }
      delete multipleSelectedMap[option];
    } else {
      // 选中
      multipleSelected.push(option);
      multipleSelectedMap[option] = true;
    }
    // 排序保持顺序
    multipleSelected.sort();
    this.setData({ 
      multipleSelected: [...multipleSelected],
      multipleSelectedMap: { ...multipleSelectedMap }
    });
  },

  // 判断题选择
  onTrueFalseSelect(e) {
    if (this.isCurrentSubmitted()) return;
    const { value } = e.currentTarget.dataset;
    this.setData({ userAnswer: value });
  },

  // 填空题输入
  onFillInput(e) {
    if (this.isCurrentSubmitted()) return;
    const { index } = e.currentTarget.dataset;
    const { value } = e.detail;
    let { fillAnswers } = this.data;
    fillAnswers[index] = value;
    this.setData({ fillAnswers: [...fillAnswers] });
  },

  // 检查答案是否正确
  checkAnswer() {
    const { currentQuestion, userAnswer, multipleSelected, fillAnswers } = this.data;
    if (!currentQuestion) return false;

    switch (currentQuestion.type) {
      case 'single':
        return userAnswer === currentQuestion.correctAnswer;
      case 'multiple':
        const correctSet = new Set(currentQuestion.correctAnswers);
        const selectedSet = new Set(multipleSelected);
        if (correctSet.size !== selectedSet.size) return false;
        for (let item of correctSet) {
          if (!selectedSet.has(item)) return false;
        }
        return true;
      case 'true_false':
        return userAnswer === String(currentQuestion.correctAnswer);
      case 'fill':
        const correctAnswers = currentQuestion.correctAnswers;
        if (fillAnswers.length !== correctAnswers.length) return false;
        for (let i = 0; i < correctAnswers.length; i++) {
          if ((fillAnswers[i] || '').trim() !== correctAnswers[i].trim()) {
            return false;
          }
        }
        return true;
      default:
        return false;
    }
  },

  // 获取提交的答案格式
  getSubmitAnswer() {
    const { currentQuestion, userAnswer, multipleSelected, fillAnswers } = this.data;
    if (!currentQuestion) return null;

    switch (currentQuestion.type) {
      case 'single':
        return userAnswer;
      case 'multiple':
        return JSON.stringify(multipleSelected);
      case 'true_false':
        return userAnswer;
      case 'fill':
        return JSON.stringify(fillAnswers);
      default:
        return null;
    }
  },

  // 检查是否已选择/填写答案
  hasAnswer() {
    const { currentQuestion, userAnswer, multipleSelected, fillAnswers } = this.data;
    if (!currentQuestion) return false;

    switch (currentQuestion.type) {
      case 'single':
        return !!userAnswer;
      case 'multiple':
        return multipleSelected.length > 0;
      case 'true_false':
        return userAnswer !== null && userAnswer !== undefined;
      case 'fill':
        return fillAnswers.some(a => a && a.trim());
      default:
        return false;
    }
  },

  // 提交答案
  async submitAnswer() {
    // 检查是否已截止
    const { endTime } = this.data;
    if (endTime && new Date() > new Date(endTime)) {
      this.setData({ isEnded: true });
      Toast({
        context: this,
        selector: '#t-toast',
        message: '练习已截止，无法提交'
      });
      return;
    }

    if (this.isCurrentSubmitted()) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '该题已提交，不能重复提交'
      });
      return;
    }

    if (!this.hasAnswer()) {
      Toast({
        context: this,
        selector: '#t-toast',
        message: '请先作答'
      });
      return;
    }

    const { practiceId, questionIdList, currentIndex, answerRecords } = this.data;
    const questionId = questionIdList[currentIndex];
    const studentAnswer = this.getSubmitAnswer();
    const isCorrect = this.checkAnswer();

    this.setData({ submitting: true });

    try {
      const res = await post('/answerRecords', {
        practiceId,
        questionId,
        studentAnswer,
        isCorrect
      });

      if (res.code === 1) {
        // 更新本地答题记录
        answerRecords[questionId] = {
          questionId,
          studentAnswer,
          isCorrect,
          submitTime: new Date().toISOString()
        };
        this.setData({ answerRecords });

        Toast({
          context: this,
          selector: '#t-toast',
          message: isCorrect ? '回答正确！' : '已提交',
          theme: isCorrect ? 'success' : 'default'
        });
      } else {
        Toast({
          context: this,
          selector: '#t-toast',
          message: res.msg || '提交失败'
        });
      }
    } catch (err) {
      console.error('提交答案失败:', err);
      Toast({
        context: this,
        selector: '#t-toast',
        message: '网络错误'
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // 上一题
  prevQuestion() {
    const { currentIndex } = this.data;
    if (currentIndex > 0) {
      this.loadQuestion(currentIndex - 1);
    }
  },

  // 下一题
  nextQuestion() {
    const { currentIndex, questionIdList } = this.data;
    if (currentIndex < questionIdList.length - 1) {
      this.loadQuestion(currentIndex + 1);
    }
  },

  // 跳转到指定题目
  goToQuestion(e) {
    const { index } = e.currentTarget.dataset;
    if (index !== this.data.currentIndex) {
      this.loadQuestion(index);
    }
  }
});
