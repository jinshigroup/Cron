/**
 * 简化版 Cron 解析器
 * 支持 Quartz 格式的 7 字段 Cron 表达式 (秒 分 时 日 月 周 年)
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.cronParser = factory());
})(this, (function () {
  'use strict';

  /**
   * 解析 Cron 表达式各字段
   * @param {string} field - 字段值
   * @param {number} min - 最小值
   * @param {number} max - 最大值
   * @param {string} fieldName - 字段名称
   * @returns {Array<number>} 解析后的值数组
   */
  function parseField(field, min, max, fieldName) {
    // 处理特殊字符 '?'
    if (field === '?' && (fieldName === 'dayOfMonth' || fieldName === 'dayOfWeek')) {
      return [];
    }

    if (field === '*') {
      return range(min, max);
    }

    if (field.includes('/')) {
      const [rangePart, step] = field.split('/');
      const rangeValues = parseField(rangePart, min, max, fieldName);
      const stepNum = parseInt(step, 10);
      return rangeValues.filter((_, index) => index % stepNum === 0);
    }

    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number);
      return range(start, end);
    }

    if (field.includes(',')) {
      return field.split(',').map(str => parseInt(str, 10));
    }

    return [parseInt(field, 10)];
  }

  /**
   * 生成范围数组
   * @param {number} start - 起始值
   * @param {number} end - 结束值
   * @returns {Array<number>} 范围数组
   */
  function range(start, end) {
    const result = [];
    for (let i = start; i <= end; i++) {
      result.push(i);
    }
    return result;
  }

  /**
   * 检查日期是否匹配
   * @param {Date} date - 要检查的日期
   * @param {Object} constraints - 约束条件
   * @returns {boolean} 是否匹配
   */
  function dateMatchesConstraints(date, constraints) {
    const second = date.getSeconds();
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1; // Date对象中月份从0开始
    const dayOfWeek = date.getDay() === 0 ? 1 : date.getDay() + 1; // 转换为 1-7 (1=周日)
    const year = date.getFullYear();

    // 检查各个字段是否匹配
    if (constraints.seconds.length > 0 && !constraints.seconds.includes(second)) return false;
    if (constraints.minutes.length > 0 && !constraints.minutes.includes(minute)) return false;
    if (constraints.hours.length > 0 && !constraints.hours.includes(hour)) return false;
    
    // 处理日期和星期的互斥关系 (Quartz特性)
    if (constraints.days.length > 0 && !constraints.days.includes(dayOfMonth)) return false;
    if (constraints.weekdays.length > 0 && !constraints.weekdays.includes(dayOfWeek)) return false;
    
    if (constraints.months.length > 0 && !constraints.months.includes(month)) return false;
    
    // 年份处理
    if (constraints.years.length > 0 && !constraints.years.includes(year)) return false;

    return true;
  }

  /**
   * 获取下一个匹配的日期
   * @param {Date} startDate - 开始日期
   * @param {Object} constraints - 约束条件
   * @returns {Date|null} 下一个匹配的日期
   */
  function getNextDate(startDate, constraints) {
    let currentDate = new Date(startDate);
    // 确保我们从下一个秒开始
    currentDate.setSeconds(currentDate.getSeconds() + 1);
    
    // 为了防止无限循环，设置一个最大尝试次数
    let tries = 0;
    const maxTries = 5 * 365 * 24 * 60 * 60; // 最多尝试五年的秒数
    
    while (tries < maxTries) {
      if (dateMatchesConstraints(currentDate, constraints)) {
        return new Date(currentDate);
      }
      
      // 增加一秒
      currentDate.setSeconds(currentDate.getSeconds() + 1);
      tries++;
      
      // 如果尝试次数过多，尝试优化搜索
      if (tries > 10000) {
        // 检查年份是否匹配
        const year = currentDate.getFullYear();
        if (constraints.years.length > 0 && !constraints.years.includes(year)) {
          // 跳到下一个年份
          currentDate.setFullYear(currentDate.getFullYear() + 1);
          currentDate.setMonth(0); // 1月
          currentDate.setDate(1);
          currentDate.setHours(0);
          currentDate.setMinutes(0);
          currentDate.setSeconds(0);
          
          // 如果年份超出限制，直接返回null
          if (constraints.years.length > 0 && currentDate.getFullYear() > Math.max(...constraints.years)) {
            return null;
          }
          continue;
        }
        
        // 检查月份是否匹配
        const month = currentDate.getMonth() + 1;
        if (constraints.months.length > 0 && !constraints.months.includes(month)) {
          // 跳到下一个月的第一天
          currentDate.setMonth(currentDate.getMonth() + 1);
          currentDate.setDate(1);
          currentDate.setHours(0);
          currentDate.setMinutes(0);
          currentDate.setSeconds(0);
          continue;
        }
        
        // 检查日期是否匹配
        const dayOfMonth = currentDate.getDate();
        if (constraints.days.length > 0 && !constraints.days.includes(dayOfMonth)) {
          // 跳到下一天
          currentDate.setDate(currentDate.getDate() + 1);
          currentDate.setHours(0);
          currentDate.setMinutes(0);
          currentDate.setSeconds(0);
          continue;
        }
      }
    }
    
    return null; // 未找到匹配的日期
  }

  /**
   * 解析 Cron 表达式
   * @param {string} expression - Cron 表达式
   * @param {Object} options - 选项
   * @returns {Object} 解析结果对象
   */
  function parseExpression(expression, options = {}) {
    const parts = expression.trim().split(/\s+/);
    
    if (parts.length !== 7) {
      throw new Error('Cron 表达式必须包含 7 个字段 (秒 分 时 日 月 周 年)');
    }

    const [seconds, minutes, hours, days, months, weekdays, years] = parts;

    // 解析各字段
    const constraints = {
      seconds: parseField(seconds, 0, 59, 'seconds'),
      minutes: parseField(minutes, 0, 59, 'minutes'),
      hours: parseField(hours, 0, 23, 'hours'),
      days: parseField(days, 1, 31, 'dayOfMonth'),
      months: parseField(months, 1, 12, 'months'),
      weekdays: parseField(weekdays, 1, 7, 'dayOfWeek'), // 1=周日, 7=周六
      years: years === '*' ? [] : parseField(years, new Date().getFullYear(), new Date().getFullYear() + 100, 'years')
    };

    // 处理日期和星期的互斥关系 (Quartz特性)
    // 如果日期字段为 '?'，则只检查星期字段
    // 如果星期字段为 '?'，则只检查日期字段
    if (days === '?') {
      constraints.days = [];
    } else if (weekdays === '?') {
      constraints.weekdays = [];
    }

    let currentDate = options.currentDate ? new Date(options.currentDate) : new Date();
    currentDate.setMilliseconds(0);
    
    return {
      next: function() {
        const nextDate = getNextDate(currentDate, constraints);
        
        if (nextDate) {
          // 更新当前日期
          currentDate = new Date(nextDate);
          
          return {
            toDate: function() {
              return new Date(nextDate);
            }
          };
        } else {
          throw new Error('无法找到下一个匹配的执行时间');
        }
      }
    };
  }

  // 公开接口
  return {
    parseExpression: parseExpression
  };
}));