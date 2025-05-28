// content_script.js
console.log("Page Cat Content Script Loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_PAGE_CONTENT') {
    console.log('Content script received GET_PAGE_CONTENT request');
    try {
      autoScrollAndExtractAllData().then(pageData => {
        sendResponse({ status: 'success', data: pageData });
      }).catch(error => {
        console.error('Error extracting page data:', error);
        sendResponse({ status: 'error', message: error.toString() });
      });
    } catch (error) {
      console.error('Error extracting page data:', error);
      sendResponse({ status: 'error', message: error.toString() });
    }
    return true; // Indicates that the response is sent asynchronously (or will be)
  }
});

// 自动滚动并采集所有内容（每次滚动都采集并合并，适配虚拟滚动页面）
async function autoScrollAndExtractAllData() {
  let lastHeight = 0;
  let sameCount = 0;
  let maxSameCount = 5; // 连续5次高度不变则认为到底
  let maxScrollTimes = 50; // 最多滚动50次，防止死循环
  let scrollTimes = 0;
  const allItemsMap = new Map(); // key: title+time+author, value: item

  while (sameCount < maxSameCount && scrollTimes < maxScrollTimes) {
    // 采集当前可见内容
    const items = extractPageData();
    items.forEach(item => {
      // 用标题+时间+作者做唯一标识
      const key = `${item.title}||${item.time}||${item.author}`;
      if (!allItemsMap.has(key)) {
        allItemsMap.set(key, item);
      }
    });

    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 800)); // 等待内容加载
    let newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      sameCount++;
    } else {
      sameCount = 0;
      lastHeight = newHeight;
    }
    scrollTimes++;
  }
  window.scrollTo(0, 0); // 回到顶部
  return Array.from(allItemsMap.values());
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

// 获取链接
function extractLink(post) {
  try {
    // 1. 首先尝试在post内查找所有a标签
    const links = post.querySelectorAll('a');
    
    // 2. 遍历所有链接，找到符合条件的
    for (const link of links) {
      // 检查class是否包含所需类名
      const hasRequiredClasses = link.classList.contains('cover') && 
                               link.classList.contains('mask') && 
                               link.classList.contains('ld');
      
      // 检查是否可见（不包含display: none）
      const isVisible = !link.style.display || link.style.display !== 'none';
      
      // 检查是否有href属性
      const hasHref = link.hasAttribute('href');
      
      if (hasRequiredClasses && isVisible && hasHref) {
        const href = link.getAttribute('href');
        if (href) {
          // 转换为完整URL
          return new URL(href, window.location.origin).href;
        }
      }
    }
    
    // 3. 如果在post内没找到，尝试在父元素中查找
    if (post.parentElement) {
      const parentLinks = post.parentElement.querySelectorAll('a');
      for (const link of parentLinks) {
        const hasRequiredClasses = link.classList.contains('cover') && 
                                 link.classList.contains('mask') && 
                                 link.classList.contains('ld');
        
        const isVisible = !link.style.display || link.style.display !== 'none';
        const hasHref = link.hasAttribute('href');
        
        if (hasRequiredClasses && isVisible && hasHref) {
          const href = link.getAttribute('href');
          if (href) {
            return new URL(href, window.location.origin).href;
          }
        }
      }
    }
    
    // 4. 如果还是没找到，尝试查找最近的可见链接
    const allLinks = post.querySelectorAll('a[href]');
    for (const link of allLinks) {
      const isVisible = !link.style.display || link.style.display !== 'none';
      if (isVisible) {
        const href = link.getAttribute('href');
        if (href) {
          return new URL(href, window.location.origin).href;
        }
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
  
  // Example: Try to find common patterns for posts/videos
  const potentialPosts = document.querySelectorAll('article, .note-item, .post, .video-item, [data-testid="feed-item"], .AMqhOzPC'); 
  
  potentialPosts.forEach((post, index) => {
    // Title
    let title = post.querySelector('h1, h2, h3, .title, .desc, .content-title');
    title = title ? title.innerText.trim() : `无标题项目 ${index + 1}`;

    // Time - Look for elements with 'time', 'date', 'timestamp' in class or attributes
    let timeElement = post.querySelector('[class*="time"], [class*="date"], .timestamp, time');
    let time = timeElement ? timeElement.innerText.trim() : '未知时间';
    time = standardizeDate(time);

    // Likes - Look for like count elements
    let likesElement = post.querySelector('[class*="like"], [class*="favorite"], [data-e2e*="like-count"], .digg_count, .AMqhOzPC');
    let likes = likesElement ? likesElement.innerText.trim() : '0';
    likes = standardizeNumber(likes);

    // Author - Try multiple methods to find author
    let author = '';
    try {
      // Method 1: Look for common author selectors
      const authorSelectors = [
        '[class*="author"], [class*="user"], [class*="creator"]',
        '[data-testid*="author"], [data-testid*="user"]',
        '.author, .user, .creator',
        'a[href*="/user/"], a[href*="/author/"]'
      ];
      
      for (const selector of authorSelectors) {
        const authorElement = post.querySelector(selector);
        if (authorElement) {
          author = authorElement.innerText.trim();
          if (author) break;
        }
      }

      // Method 2: Try to find author from parent elements
      if (!author) {
        const parentElements = post.parentElement ? [post.parentElement, post.parentElement.parentElement] : [];
        for (const parent of parentElements) {
          if (parent) {
            const authorElement = parent.querySelector('[class*="author"], [class*="user"], [class*="creator"]');
            if (authorElement) {
              author = authorElement.innerText.trim();
              if (author) break;
            }
          }
        }
      }

      // Method 3: Look for author in nearby elements
      if (!author) {
        const nearbyElements = post.previousElementSibling ? [post.previousElementSibling] : [];
        for (const element of nearbyElements) {
          if (element) {
            const authorElement = element.querySelector('[class*="author"], [class*="user"], [class*="creator"]');
            if (authorElement) {
              author = authorElement.innerText.trim();
              if (author) break;
            }
          }
        }
      }
    } catch (e) {
      console.error('Error extracting author:', e);
      author = '';
    }

    // Link - 使用新的链接提取函数
    const link = extractLink(post);

    results.push({
      title: title,
      time: time,
      likes: likes,
      author: author,
      url: link
    });
  });

  console.log(`Extracted ${results.length} potential items.`);
  if (results.length === 0) {
    console.warn("No items extracted. The selectors might need adjustment for this specific site.");
    return {
      error: "Could not find structured items. Page content extraction needs specific selectors for this site.",
      pageTitle: document.title,
      pageText: document.body.innerText.substring(0, 2000)
    }
  }
  return results;
}
