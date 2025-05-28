// background.js
console.log('Background Service Worker Started.');

// 添加侧边栏打开逻辑
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PROCESS_PAGE_CONTENT') {
    console.log('Background: Received PROCESS_PAGE_CONTENT', request);
    const { tabId, query, config } = request;

    // 1. Inject content script if not already injected (or ensure it's ready)
    //    For simplicity, we assume content_script is declared in manifest.json for relevant pages
    //    or use programmatic injection if needed.
    //    Here, we'll directly ask the content script for data.
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        files: ['content_script.js'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Error injecting script:', chrome.runtime.lastError.message);
          sendResponse({ error: `Failed to inject content script: ${chrome.runtime.lastError.message}` });
          return;
        }
        
        // 2. Get content from the content script
        chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTENT' }, async (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error getting page content:', chrome.runtime.lastError.message);
            sendResponse({ error: `Error communicating with content script: ${chrome.runtime.lastError.message}` });
            return;
          }

          if (response && response.status === 'success') {
            const pageData = response.data;
            console.log('Background: Received data from content script:', pageData);

            // 3. Call LLM API
            try {
              const llmResponse = await callLlmApi(pageData, query, config);
              console.log('Background: Received data from LLM:', llmResponse);
              sendResponse({ data: llmResponse });
            } catch (error) {
              console.error('Error calling LLM API:', error);
              sendResponse({ error: `LLM API Error: ${error.toString()}` });
            }
          } else {
            const errorMessage = response && response.message ? response.message : 'Unknown error from content script.';
            console.error('Background: Error or no data from content script:', errorMessage);
            sendResponse({ error: `Content script error: ${errorMessage}` });
          }
        });
      }
    );
    return true; // Indicates that the response will be sent asynchronously
  }
});

async function callLlmApi(pageContent, userQuery, config) {
  if (!config || !config.baseUrl || !config.apiKey || !config.modelName) {
    throw new Error('API configuration is missing. Please set up the xAI API Base URL, API Key and Model Name in the extension settings.');
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: [
          {
            role: "user",
            content: `你是一个帮助用户从大量社交媒体原始内容中提取有用信息的助手。请根据用户的指令，分析提供的内容并返回相应的结果。

 ### 原始内容
${JSON.stringify(pageContent)}

### 用户指令
${userQuery}           

### 要求
当需要返回表格数据时，请使用以下格式的 markdown 表格：

| 标题 | 作者 | 时间 | 点赞数 | 链接 |
|------|------|------|--------|------|
| 标题1 | 作者1 | 时间1 | 点赞数1 | [查看](url1) |
| 标题2 | 作者2 | 时间2 | 点赞数2 | [查看](url2) |

### 注意事项：
1. 表格必须包含表头和分隔行（第二行的破折号）
2. 每列之间使用 | 分隔
3. 表头使用中文，如：标题、作者、时间、点赞数、链接
4. 时间格式统一为：YYYY-MM-DD 或 X天前
5. 点赞数使用纯数字，不要带单位
6. 标题中的特殊字符（如emoji）可以保留
7. 链接列使用 markdown 格式 [查看](url)，url 必须是完整的链接地址
8. 作者列显示发布者的账号名称

### 返回结果
请直接返回表格数据，不要包含任何其他内容。
`
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error?.message || `API request failed with status ${response.status}`);
    }

    const data = await response.json();
    
    // 处理API响应
    if (data.choices && data.choices.length > 0) {
      const result = data.choices[0].message.content;
      
      // 尝试解析JSON响应
      try {
        return JSON.parse(result);
      } catch (e) {
        // 如果不是JSON，直接返回文本
        return result;
      }
    } else {
      throw new Error('Invalid response format from API');
    }
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

// Create dummy icons if they don't exist (for local development without providing actual icons)
// This part is usually not needed if icons are packed with the extension.
// chrome.runtime.onInstalled.addListener(() => {
//   // console.log('Extension installed/updated.');
//   // You might want to set up default storage values here if needed
// });
