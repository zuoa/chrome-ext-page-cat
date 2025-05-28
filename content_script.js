// content_script.js
console.log("Page Cat Content Script Loaded");

// 添加滚动函数
async function scrollToBottom() {
  return new Promise((resolve, reject) => {
    let lastScrollHeight = 0;
    let scrollAttempts = 0;
    let noChangeCount = 0;
    let lastContentCount = 0;
    let consecutiveNoNewContent = 0;
    
    const maxAttempts = 300;
    const maxNoChange = 8;
    const maxNoNewContent = 5;
    const minScrollDelay = 500;
    const maxScrollDelay = 2000;
    const minHeightChange = 50;
    
    let allResults = new Map();
    let scrollDelay = minScrollDelay;
    let isScrolling = true;

    // 发送进度更新
    function sendProgress(progress, message) {
      chrome.runtime.sendMessage({
        type: 'SCROLL_PROGRESS',
        progress,
        message
      });
    }

    // 检查是否有新内容加载
    async function checkNewContent() {
      const newResults = await extractNewContent(allResults);
      let newCount = 0;
      
      newResults.forEach(result => {
        const uniqueKey = `${result.title}-${result.author}`;
        if (!allResults.has(uniqueKey)) {
          allResults.set(uniqueKey, result);
          newCount++;
        }
      });

      return newCount;
    }

    // 动态调整滚动延迟
    function adjustScrollDelay(newContentCount) {
      if (newContentCount === 0) {
        scrollDelay = Math.min(scrollDelay * 1.5, maxScrollDelay);
      } else {
        scrollDelay = Math.max(scrollDelay * 0.8, minScrollDelay);
      }
    }

    const scrollInterval = setInterval(async () => {
      if (!isScrolling) {
        clearInterval(scrollInterval);
        return;
      }

      try {
        // 保存当前高度
        const currentHeight = document.documentElement.scrollHeight;
        
        // 滚动到底部
        window.scrollTo({
          top: currentHeight,
          behavior: 'smooth'
        });
        
        scrollAttempts++;

        // 检查新内容
        const newContentCount = await checkNewContent();
        
        // 更新进度
        const progress = Math.min((scrollAttempts / maxAttempts) * 100, 100);
        sendProgress(progress, `已加载 ${allResults.size} 条笔记`);

        // 检查高度变化
        const heightDifference = Math.abs(currentHeight - lastScrollHeight);
        if (heightDifference < minHeightChange) {
          noChangeCount++;
        } else {
          noChangeCount = 0;
        }

        // 检查新内容加载情况
        if (newContentCount === 0) {
          consecutiveNoNewContent++;
        } else {
          consecutiveNoNewContent = 0;
        }

        // 动态调整滚动延迟
        adjustScrollDelay(newContentCount);

        // 检查是否应该停止滚动
        if (noChangeCount >= maxNoChange || 
            scrollAttempts >= maxAttempts || 
            consecutiveNoNewContent >= maxNoNewContent) {
          
          isScrolling = false;
          clearInterval(scrollInterval);
          
          // 最后一次检查新内容
          await checkNewContent();
          
          // 滚动回顶部
          window.scrollTo({
            top: 0,
            behavior: 'smooth'
          });

          // 等待内容加载完成
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          console.log(`滚动完成，最终笔记总数: ${allResults.size} 条`);
          resolve(Array.from(allResults.values()));
        }
        
        lastScrollHeight = currentHeight;
        lastContentCount = allResults.size;

      } catch (error) {
        console.error('Scroll error:', error);
        isScrolling = false;
        clearInterval(scrollInterval);
        reject(error);
      }
    }, scrollDelay);

    // 添加错误处理
    window.addEventListener('error', (event) => {
      console.error('Page error:', event.error);
      isScrolling = false;
      clearInterval(scrollInterval);
      reject(new Error('Page error occurred during scrolling'));
    });

    // 添加网络错误处理
    window.addEventListener('offline', () => {
      console.error('Network connection lost');
      isScrolling = false;
      clearInterval(scrollInterval);
      reject(new Error('Network connection lost'));
    });
  });
}

// 提取新内容
async function extractNewContent(existingResults) {
  const results = [];
  const selectors = [
    'section.note-item',
    '[data-v-a264b01a].note-item',
    '[data-v-330d9cca].note-item'
  ];

  const potentialPosts = document.querySelectorAll(selectors.join(', '));
  
  potentialPosts.forEach((post, index) => {
    // 检查元素是否可见
    const rect = post.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) {
      return;
    }

    // Title
    let title = '';
    const titleElement = post.querySelector('.title span');
    if (titleElement) {
      title = titleElement.textContent.trim();
    }

    if (!title) {
      const img = post.querySelector('img[data-xhs-img]');
      if (img && img.alt) {
        title = img.alt.trim();
      }
    }

    // 如果是无标题项目，跳过
    if (!title || title.startsWith('无标题项目')) {
      return;
    }

    title = title.replace(/\s+/g, ' ').replace(/[\r\n]+/g, ' ').trim();

    // Author
    let author = '';
    const authorElement = post.querySelector('.author .name .name');
    if (authorElement) {
      author = authorElement.textContent.trim();
    }

    // 使用标题和作者作为唯一标识
    const uniqueKey = `${title}-${author}`;
    if (existingResults.has(uniqueKey)) {
      return; // 跳过已处理的内容
    }

    // Time
    let time = '未知时间';
    const timeElement = post.querySelector('.time .time');
    if (timeElement) {
      time = timeElement.textContent.trim();
    }
    time = standardizeDate(time);

    // Likes
    let likes = '0';
    const likeElement = post.querySelector('.like-wrapper .count');
    if (likeElement) {
      likes = likeElement.textContent.trim();
    }
    likes = standardizeNumber(likes);

    // Link
    let link = '';
    const linkElement = post.querySelector('a.cover.mask.ld');
    if (linkElement && linkElement.href) {
      link = linkElement.href;
    }

    // 添加更多可能的字段
    let description = '';
    const descElement = post.querySelector('.desc');
    if (descElement) {
      description = descElement.textContent.trim();
    }

    let tags = [];
    const tagElements = post.querySelectorAll('.tag');
    tagElements.forEach(tag => {
      const tagText = tag.textContent.trim();
      if (tagText) {
        tags.push(tagText);
      }
    });

    results.push({
      title,
      time,
      likes,
      author,
      url: link,
      description,
      tags
    });
  });

  return results;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_PAGE_CONTENT') {
    console.log('Content script received GET_PAGE_CONTENT request');
    (async () => {
      try {
        // 滚动并获取所有内容
        const allResults = await scrollToBottom();
        // 等待确保所有内容都加载完成
        await new Promise(resolve => setTimeout(resolve, 5000));
        // 发送结果
        sendResponse({ 
          status: 'success', 
          data: allResults,
          metadata: {
            totalNotes: allResults.length,
            url: window.location.href,
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        console.error('Error extracting page data:', error);
        sendResponse({ status: 'error', message: error.toString() });
      }
    })();
    return true;
  }
});

// 标准化日期格式
function standardizeDate(dateStr) {
  if (!dateStr) return '未知时间';
  
  // 处理"X天前"格式
  const daysAgoMatch = dateStr.match(/(\d+)天前/);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1]);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return formatDate(date);
  }

  // 处理"X小时前"格式
  const hoursAgoMatch = dateStr.match(/(\d+)小时前/);
  if (hoursAgoMatch) {
    const hours = parseInt(hoursAgoMatch[1]);
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return formatDate(date);
  }

  // 处理"X分钟前"格式
  const minutesAgoMatch = dateStr.match(/(\d+)分钟前/);
  if (minutesAgoMatch) {
    const minutes = parseInt(minutesAgoMatch[1]);
    const date = new Date();
    date.setMinutes(date.getMinutes() - minutes);
    return formatDate(date);
  }

  // 处理"刚刚"格式
  if (dateStr === '刚刚') {
    return formatDate(new Date());
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
      return formatDate(date);
    }
  } catch (e) {}

  return dateStr;
}

// 格式化日期为标准格式
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}`;
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

// 获取链接
function extractLink(post) {
  try {
    // 直接从封面链接获取
    const linkElement = post.querySelector('a.cover.mask.ld');
    if (linkElement && linkElement.href) {
      return linkElement.href;
    }
    
    // 如果没有找到封面链接，尝试其他链接
    const links = post.querySelectorAll('a[href]');
    for (const link of links) {
      if (link.href && !link.href.includes('javascript:')) {
        return link.href;
      }
    }
    
    return '';
  } catch (e) {
    console.error('Error extracting link:', e);
    return '';
  }
}

function extractPageData() {
  console.log("Attempting to extract page data...");
  const results = [];
  
  // 使用精确的选择器
  const selectors = [
    'section.note-item',  // 主要选择器
    '[data-v-a264b01a].note-item',  // 带特定属性的选择器
    '[data-v-330d9cca].note-item'   // 带特定属性的选择器
  ];

  // 使用所有选择器组合
  const potentialPosts = document.querySelectorAll(selectors.join(', '));
  console.log(`Total elements found with all selectors: ${potentialPosts.length}`);
  
  if (potentialPosts.length === 0) {
    console.log('Page structure:', document.body.innerHTML.substring(0, 1000));
    return {
      error: "Could not find structured items. Page content extraction needs specific selectors for this site.",
      pageTitle: document.title,
      pageText: document.body.innerText.substring(0, 2000),
      debug: {
        url: window.location.href,
        selectors: selectors,
        bodyClasses: document.body.className,
        bodyId: document.body.id
      }
    }
  }

  // 使用 Set 来存储已处理的内容，避免重复
  const processedContent = new Set();

  potentialPosts.forEach((post, index) => {
    // 获取内容的唯一标识
    const contentId = post.getAttribute('data-index') || 
                     post.getAttribute('data-v-a264b01a') || 
                     post.outerHTML;

    // 如果内容已经处理过，跳过
    if (processedContent.has(contentId)) {
      return;
    }
    processedContent.add(contentId);

    // 检查元素是否可见
    const rect = post.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) {
      return;
    }

    // Title - 直接从标题元素获取
    let title = '';
    const titleElement = post.querySelector('.title span');
    if (titleElement) {
      title = titleElement.textContent.trim();
    }

    // 如果没找到标题，尝试从图片alt获取
    if (!title) {
      const img = post.querySelector('img[data-xhs-img]');
      if (img && img.alt) {
        title = img.alt.trim();
      }
    }

    // 如果仍然没找到标题，使用默认标题
    title = title || `无标题项目 ${index + 1}`;

    // 清理标题文本
    title = title
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .trim();

    // Time - 直接从时间元素获取
    let time = '未知时间';
    const timeElement = post.querySelector('.time .time');
    if (timeElement) {
      time = timeElement.textContent.trim();
    }
    time = standardizeDate(time);

    // Likes - 直接从点赞数元素获取
    let likes = '0';
    const likeElement = post.querySelector('.like-wrapper .count');
    if (likeElement) {
      likes = likeElement.textContent.trim();
    }
    likes = standardizeNumber(likes);

    // Author - 直接从作者元素获取
    let author = '';
    const authorElement = post.querySelector('.author .name .name');
    if (authorElement) {
      author = authorElement.textContent.trim();
    }

    // Link - 直接从链接元素获取
    let link = '';
    const linkElement = post.querySelector('a.cover.mask.ld');
    if (linkElement && linkElement.href) {
      link = linkElement.href;
    }

    results.push({
      title: title,
      time: time,
      likes: likes,
      author: author,
      url: link
    });
  });

  console.log(`Extracted ${results.length} potential items.`);
  return results;
}
