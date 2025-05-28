// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const processPageButton = document.getElementById('processPage');
  const userInput = document.getElementById('userInput');
  const resultTableContainer = document.getElementById('resultTableContainer');
  const statusDiv = document.getElementById('status');
  const baseUrlInput = document.getElementById('baseUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const modelNameInput = document.getElementById('modelName');
  const saveConfigButton = document.getElementById('saveConfig');
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const historyContainer = document.getElementById('historyContainer');
  const loadingOverlay = document.querySelector('.loading-overlay');
  const loadingText = document.querySelector('.loading-text');
  const progressBarFill = document.querySelector('.progress-bar-fill');

  // Show loading state with progress
  function showLoading(message, progress = 0) {
    loadingOverlay.classList.add('active');
    loadingText.textContent = message;
    progressBarFill.style.width = `${progress}%`;
  }

  // Hide loading state
  function hideLoading() {
    loadingOverlay.classList.remove('active');
    progressBarFill.style.width = '0%';
  }

  // Update loading progress
  function updateProgress(progress) {
    progressBarFill.style.width = `${progress}%`;
  }

  // 加载保存的配置
  chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName'], (result) => {
    if (result.baseUrl) baseUrlInput.value = result.baseUrl;
    if (result.apiKey) apiKeyInput.value = result.apiKey;
    if (result.modelName) modelNameInput.value = result.modelName;
  });

  // 标签页切换
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      
      // 更新标签页状态
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 更新内容显示
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `${tabId}-tab`) {
          content.classList.add('active');
        }
      });
    });
  });

  // 保存配置
  saveConfigButton.addEventListener('click', () => {
    const baseUrl = baseUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const modelName = modelNameInput.value.trim();

    chrome.storage.sync.set({
      baseUrl: baseUrl,
      apiKey: apiKey,
      modelName: modelName
    }, () => {
      statusDiv.textContent = '配置已保存！';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    });
  });

  // 加载历史输入
  function loadHistory() {
    chrome.storage.local.get(['inputHistory'], (result) => {
      const history = result.inputHistory || [];
      renderHistory(history);
    });
  }

  // 渲染历史输入
  function renderHistory(history) {
    if (!history.length) {
      historyContainer.innerHTML = '';
      return;
    }
    historyContainer.innerHTML = history.map((item, idx) =>
      `<button class="history-btn" style="margin-right:6px;margin-bottom:4px;padding:4px 10px;font-size:12px;border:1px solid #dadce0;border-radius:3px;background:#797979;cursor:pointer;" data-idx="${idx}">${item.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</button>`
    ).join('');
    // 绑定点击事件
    Array.from(historyContainer.querySelectorAll('.history-btn')).forEach((btn, idx) => {
      btn.onclick = () => {
        userInput.value = history[idx];
      };
    });
  }

  // 保存历史输入
  function saveHistory(input) {
    chrome.storage.local.get(['inputHistory'], (result) => {
      let history = result.inputHistory || [];
      // 去重，最新的放最前
      history = history.filter(item => item !== input);
      history.unshift(input);
      if (history.length > 5) history = history.slice(0, 5);
      chrome.storage.local.set({ inputHistory: history }, () => {
        renderHistory(history);
      });
    });
  }

  // 页面加载时渲染历史
  loadHistory();

  processPageButton.addEventListener('click', async () => {
    showLoading('正在获取网页内容...', 10);
    resultTableContainer.innerHTML = '<p>结果将显示在这里...</p>'; // Reset result area

    const query = userInput.value;
    if (!query) {
      hideLoading();
      statusDiv.textContent = '请输入您的指令。';
      return;
    }

    saveHistory(query); // 保存历史

    try {
      // 获取配置
      const config = await new Promise((resolve) => {
        chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName'], resolve);
      });

      if (!config.baseUrl || !config.apiKey || !config.modelName) {
        hideLoading();
        statusDiv.textContent = '请先在配置页面设置 API Base URL、API Key 和模型名称。';
        return;
      }

      // 1. Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab && tab.id) {
        // 保持当前进度条状态，继续显示"正在获取网页内容..."
        
        // 2. Send message to content script to extract data
        chrome.runtime.sendMessage(
          { 
            type: 'PROCESS_PAGE_CONTENT', 
            tabId: tab.id, 
            query: query,
            config: config
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('Error sending message:', chrome.runtime.lastError.message);
              hideLoading();
              statusDiv.textContent = `错误: ${chrome.runtime.lastError.message}`;
              return;
            }
            
            if (response && response.error) {
              console.error('Error from background script:', response.error);
              hideLoading();
              statusDiv.textContent = `处理错误: ${response.error}`;
            } else if (response && response.data) {
              // 切换到处理数据阶段
              showLoading('正在处理数据，请耐心等候...', 50);
              displayResults(response.data);
              showLoading('处理完成', 100);
              setTimeout(hideLoading, 500);
              statusDiv.textContent = '处理完成！';
            } else {
              hideLoading();
              statusDiv.textContent = '未收到有效响应。';
            }
          }
        );
      } else {
        hideLoading();
        statusDiv.textContent = '无法获取当前活动标签页。';
      }
    } catch (error) {
      console.error('Error in popup:', error);
      hideLoading();
      statusDiv.textContent = `发生错误: ${error.message}`;
    }
  });

  function displayResults(data) {
    if (!data) {
      resultTableContainer.innerHTML = '<p>没有提取到符合条件的数据，或者返回格式不正确。</p>';
      return;
    }

    if (typeof data === 'string') {
      // 提取 markdown 表格部分，包括表头、分隔行和数据行
      const tableMatch = data.match(/\|.+\n\|[-:]+\n(?:\|.+\n)+/);
      if (tableMatch) {
        const tableText = tableMatch[0];
        const lines = tableText.trim().split('\n');
        
        // 确保至少有表头、分隔行和一行数据
        if (lines.length >= 3) {
          // 解析表头
          const headers = lines[0].split('|')
            .filter(h => h.trim())
            .map(h => h.trim());
          
          // 创建表格 HTML
          let tableHTML = `
            <div class="table-header">
              <div class="table-title">分析结果</div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="table-info">共 ${lines.length - 2} 条记录</div>
                <button id="copyToClipboard" style="padding: 4px 8px; font-size: 12px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">复制到剪贴板</button>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  ${headers.map(header => `<th>${formatColumnName(header)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
          `;

          // 跳过表头和分隔行，处理数据行
          for (let i = 2; i < lines.length; i++) {
            const cells = lines[i].split('|')
              .filter(c => c.trim())
              .map(c => c.trim());
            
            if (cells.length === headers.length) {
              tableHTML += '<tr>';
              cells.forEach((cell, index) => {
                const columnName = headers[index].toLowerCase();
                tableHTML += `<td>${formatMarkdownCell(cell, columnName)}</td>`;
              });
              tableHTML += '</tr>';
            }
          }

          tableHTML += '</tbody></table>';
          resultTableContainer.innerHTML = tableHTML;
          
          // 添加复制按钮事件监听
          const copyButton = document.getElementById('copyToClipboard');
          if (copyButton) {
            copyButton.onclick = copyTableToClipboard;
          }
          return;
        }
      }
      
      // 如果不是表格格式，尝试直接解析文本中的表格
      const lines = data.trim().split('\n');
      if (lines.length >= 3 && lines[0].includes('|') && lines[1].includes('|')) {
        // 解析表头
        const headers = lines[0].split('|')
          .filter(h => h.trim())
          .map(h => h.trim());
        
        // 创建表格 HTML
        let tableHTML = `
          <div class="table-header">
            <div class="table-title">分析结果</div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="table-info">共 ${lines.length - 2} 条记录</div>
              <button id="copyToClipboard" style="padding: 4px 8px; font-size: 12px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">复制到剪贴板</button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                ${headers.map(header => `<th>${formatColumnName(header)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
        `;

        // 跳过表头和分隔行，处理数据行
        for (let i = 2; i < lines.length; i++) {
          const cells = lines[i].split('|')
            .filter(c => c.trim())
            .map(c => c.trim());
          
          if (cells.length === headers.length) {
            tableHTML += '<tr>';
            cells.forEach((cell, index) => {
              const columnName = headers[index].toLowerCase();
              tableHTML += `<td>${formatMarkdownCell(cell, columnName)}</td>`;
            });
            tableHTML += '</tr>';
          }
        }

        tableHTML += '</tbody></table>';
        resultTableContainer.innerHTML = tableHTML;
        
        // 添加复制按钮事件监听
        const copyButton = document.getElementById('copyToClipboard');
        if (copyButton) {
          copyButton.onclick = copyTableToClipboard;
        }
        return;
      }
      
      // 如果都不是表格格式，直接显示文本
      resultTableContainer.innerHTML = `<p>${data}</p>`;
      return;
    }

    // 处理对象数组类型的数据
    if (Array.isArray(data)) {
      // 获取所有可能的列
      const columns = new Set();
      data.forEach(item => {
        if (item && typeof item === 'object') {
          Object.keys(item).forEach(key => columns.add(key));
        }
      });
      
      // 将Set转换为数组并排序
      const sortedColumns = Array.from(columns).sort((a, b) => {
        // 自定义列顺序
        const order = {
          title: 0,
          time: 1,
          likes: 2,
          content: 3,
          author: 4,
          url: 5
        };
        return (order[a] ?? 999) - (order[b] ?? 999);
      });

      // 创建表头
      let tableHTML = `
        <div class="table-header">
          <div class="table-title">分析结果</div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="table-info">共 ${data.length} 条记录</div>
            <button id="copyToClipboard" style="padding: 4px 8px; font-size: 12px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">复制到剪贴板</button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              ${sortedColumns.map(col => `<th>${formatColumnName(col)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
      `;

      // 添加数据行
      data.forEach(item => {
        if (item && typeof item === 'object') {
          tableHTML += '<tr>';
          sortedColumns.forEach(col => {
            const value = item[col];
            tableHTML += `<td>${formatCellValue(value, col)}</td>`;
          });
          tableHTML += '</tr>';
        }
      });

      tableHTML += '</tbody></table>';
      resultTableContainer.innerHTML = tableHTML;
      
      // 添加复制按钮事件监听
      const copyButton = document.getElementById('copyToClipboard');
      if (copyButton) {
        copyButton.onclick = copyTableToClipboard;
      }
      return;
    }

    resultTableContainer.innerHTML = '<p>没有提取到符合条件的数据，或者返回格式不正确。</p>';
  }

  // 格式化列名
  function formatColumnName(column) {
    const nameMap = {
      '标题': '标题',
      '作者': '作者',
      '时间': '时间',
      '点赞数': '点赞数',
      '链接': '链接',
      'title': '标题',
      'author': '作者',
      'time': '时间',
      'likes': '点赞数',
      'url': '链接'
    };
    return nameMap[column] || column;
  }

  // 标准化日期格式
  function standardizeDate(dateStr) {
    if (!dateStr) return 'N/A';
    
    // 处理"X天前"格式
    const daysAgoMatch = dateStr.match(/(\d+)天前/);
    if (daysAgoMatch) {
      const days = parseInt(daysAgoMatch[1]);
      const date = new Date();
      date.setDate(date.getDate() - days);
      return date.toISOString();
    }

    // 处理"X小时前"格式
    const hoursAgoMatch = dateStr.match(/(\d+)小时前/);
    if (hoursAgoMatch) {
      const hours = parseInt(hoursAgoMatch[1]);
      const date = new Date();
      date.setHours(date.getHours() - hours);
      return date.toISOString();
    }

    // 处理"X分钟前"格式
    const minutesAgoMatch = dateStr.match(/(\d+)分钟前/);
    if (minutesAgoMatch) {
      const minutes = parseInt(minutesAgoMatch[1]);
      const date = new Date();
      date.setMinutes(date.getMinutes() - minutes);
      return date.toISOString();
    }

    // 处理"刚刚"格式
    if (dateStr === '刚刚') {
      return new Date().toISOString();
    }

    // 尝试解析标准日期格式
    try {
      // 检查是否包含年份
      const hasYear = /\d{4}年/.test(dateStr);
      if (!hasYear) {
        // 如果没有年份，添加当前年份
        const currentYear = new Date().getFullYear();
        // 处理常见的日期格式
        if (dateStr.includes('月') && dateStr.includes('日')) {
          dateStr = `${currentYear}年${dateStr}`;
        } else if (dateStr.includes('-')) {
          // 处理 MM-DD 格式
          dateStr = `${currentYear}-${dateStr}`;
        } else if (dateStr.includes('/')) {
          // 处理 MM/DD 格式
          dateStr = `${currentYear}/${dateStr}`;
        }
      }
      
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch (e) {}

    return dateStr;
  }

  // 标准化数字格式
  function standardizeNumber(numStr) {
    if (!numStr) return 0;
    
    // 处理"万"单位
    const wanMatch = numStr.match(/([\d.]+)万/);
    if (wanMatch) {
      return Math.round(parseFloat(wanMatch[1]) * 10000);
    }

    // 处理"亿"单位
    const yiMatch = numStr.match(/([\d.]+)亿/);
    if (yiMatch) {
      return Math.round(parseFloat(yiMatch[1]) * 100000000);
    }

    // 处理带逗号的数字
    const cleanNum = numStr.replace(/,/g, '');
    
    // 尝试解析纯数字
    const num = parseInt(cleanNum);
    return isNaN(num) ? 0 : num;
  }

  // 格式化单元格值
  function formatCellValue(value, column) {
    if (value === null || value === undefined) return 'N/A';
    
    switch (column) {
      case 'time':
        // 标准化并格式化时间
        const standardizedDate = standardizeDate(value);
        try {
          const date = new Date(standardizedDate);
          if (!isNaN(date.getTime())) {
            return date.toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            });
          }
        } catch (e) {}
        return value;
      
      case 'likes':
        // 标准化并格式化数字
        const standardizedNum = standardizeNumber(value);
        return standardizedNum.toLocaleString('zh-CN');
      
      case 'url':
        // 如果是URL，创建可点击的链接
        if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
          return `<a href="${value}" target="_blank" style="color: #1a73e8; text-decoration: none;">查看</a>`;
        }
        return value;
      
      case 'content':
        // 如果内容太长，截断显示
        if (typeof value === 'string' && value.length > 100) {
          return value.substring(0, 100) + '...';
        }
        return value;
      
      default:
        return value;
    }
  }

  // 格式化 markdown 单元格内容
  function formatMarkdownCell(value, columnName) {
    if (!value) return 'N/A';

    // 处理链接格式 [text](url)
    if (columnName === '链接' || columnName === 'url') {
      const linkMatch = value.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        return `<a href="${linkMatch[2]}" target="_blank" style="color: #1a73e8; text-decoration: none;">${linkMatch[1]}</a>`;
      }
      // 如果是直接的 URL
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return `<a href="${value}" target="_blank" style="color: #1a73e8; text-decoration: none;">查看</a>`;
      }
    }

    // 处理加粗格式 **text**
    value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 处理斜体格式 *text*
    value = value.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 处理时间格式
    if (columnName === '时间' || columnName === 'time') {
      try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      } catch (e) {}
    }

    // 处理点赞数格式
    if (columnName === '点赞数' || columnName === 'likes') {
      const num = parseInt(value);
      if (!isNaN(num)) {
        return num.toLocaleString('zh-CN');
      }
    }

    return value;
  }

  // 复制表格到剪贴板
  async function copyTableToClipboard() {
    const table = resultTableContainer.querySelector('table');
    if (!table) {
      statusDiv.textContent = '没有可复制的数据';
      return;
    }

    try {
      // 获取表头
      const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
      
      // 获取数据行
      const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
        return Array.from(tr.querySelectorAll('td')).map(td => {
          // 如果是链接，获取完整URL而不是显示文本
          const link = td.querySelector('a');
          if (link) {
            const href = link.getAttribute('href');
            return href || link.textContent.trim();
          }
          return td.textContent.trim();
        });
      });

      // 构建制表符分隔的文本
      const text = [
        headers.join('\t'),
        ...rows.map(row => row.join('\t'))
      ].join('\n');

      // 复制到剪贴板
      await navigator.clipboard.writeText(text);
      
      statusDiv.textContent = '已复制到剪贴板，可以直接粘贴到Excel中';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    } catch (error) {
      console.error('Copy error:', error);
      statusDiv.textContent = '复制失败，请手动复制表格内容';
    }
  }

  // 添加消息监听器
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCROLL_PROGRESS') {
      console.log('SCROLL_PROGRESS', message);
      updateProgress(message.progress);
      if (message.message) {
        statusDiv.textContent = message.message;
      }
    }
  });
});
