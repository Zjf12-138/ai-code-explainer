// content.js - 注入网页，负责侧边栏面板和 API 调用（支持多轮追问）

// ============================
// 全局状态
// ============================
let panel = null;
let isPanelVisible = false;
let currentAbortController = null;
let dragData = null;

// 对话相关
let conversationHistory = [];      // { role: 'system'|'user'|'assistant', content: string }
let currentAssistantContent = ''; // 当前正在流式输出的 AI 回复内容
let isStreaming = false;          // 是否正在等待 AI 回复

// ============================
// 初始化：监听 background 消息
// ============================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'explainCode' && message.selectedText) {
    handleExplainRequest(message.selectedText);
  }
});

// ============================
// 处理右键菜单的解释请求（开启新一轮对话）
// ============================
async function handleExplainRequest(selectedText) {
  // 读取 API 设置
  const { apiKey, apiBase } = await chrome.storage.local.get(['apiKey', 'apiBase']);

  if (!apiKey) {
    return alert('❌ 请先设置 API Key。\n点击浏览器工具栏的扩展图标进行设置。');
  }

  // 如果面板已存在，关闭后重建（重置对话）
  if (panel && isPanelVisible) {
    closePanel();
  }

  // 重置对话历史
  conversationHistory = [
    {
      role: 'system',
      content: '你是一位资深软件工程师。请用中文简洁地解释以下代码的功能、关键逻辑和潜在问题。如果用户追问，请继续深入回答。'
    },
    {
      role: 'user',
      content: `请解释以下代码：\n\`\`\`\n${selectedText}\n\`\`\``
    }
  ];
  currentAssistantContent = '';

  // 创建面板并显示加载状态
  createPanel();
  renderConversation(); // 渲染当前对话（此时只有用户消息的标记）

  // 调用 API
  await callApiAndStream(apiKey, apiBase, conversationHistory);
}

// ============================
// 处理用户在输入框中的追问
// ============================
async function handleSendQuestion() {
  if (isStreaming) return; // 正在回复中，不允许发送

  const inputEl = document.getElementById('ai-question-input');
  if (!inputEl) return;

  const question = inputEl.value.trim();
  if (!question) return;

  // 禁用输入框和按钮
  inputEl.disabled = true;
  const sendBtn = document.getElementById('ai-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  // 清空输入框
  inputEl.value = '';

  // 将用户问题追加到对话历史
  conversationHistory.push({ role: 'user', content: question });
  currentAssistantContent = '';

  // 渲染新问题标记
  renderConversation();
  scrollToBottom();

  // 读取 API 设置并调用
  const { apiKey, apiBase } = await chrome.storage.local.get(['apiKey', 'apiBase']);
  if (!apiKey) {
    alert('❌ 未找到 API Key，请重新设置。');
    return;
  }

  await callApiAndStream(apiKey, apiBase, conversationHistory);

  // 恢复输入框
  inputEl.disabled = false;
  if (sendBtn) sendBtn.disabled = false;
  inputEl.focus();
}

// ============================
// 调用流式 API（通用）
// ============================
async function callApiAndStream(apiKey, apiBase, messages) {
  // 取消上一个请求
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();

  const baseUrl = apiBase || 'https://api.deepseek.com/v1';
  const apiUrl = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  currentAssistantContent = '';
  isStreaming = true;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        stream: true,
        temperature: 0.3,
      }),
      signal: currentAbortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 错误 (${response.status}): ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            currentAssistantContent += content;
            // 实时更新面板：渲染对话，但最新 AI 回复用流式内容
            renderConversation(currentAssistantContent);
            scrollToBottom();
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    // 流结束：将完整的 AI 回复正式存入对话历史
    if (currentAssistantContent) {
      conversationHistory.push({ role: 'assistant', content: currentAssistantContent });
      currentAssistantContent = '';
      renderConversation();
      scrollToBottom();
    } else {
      // 没有返回内容
      conversationHistory.push({ role: 'assistant', content: '（AI 未返回内容）' });
      renderConversation();
    }

  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('API 请求失败:', error);
    conversationHistory.push({ role: 'assistant', content: `❌ 请求失败：${error.message}` });
    renderConversation();
  } finally {
    isStreaming = false;
    currentAbortController = null;
  }
}

// ============================
// 渲染对话历史到面板内容区
// ============================
function renderConversation(streamingContent = null) {
  const contentDiv = document.getElementById('ai-panel-content');
  if (!contentDiv) return;

  let html = '';

  for (let i = 0; i < conversationHistory.length; i++) {
    const msg = conversationHistory[i];
    if (msg.role === 'system') continue; // 不显示系统消息

    if (msg.role === 'user') {
      html += `
        <div class="ai-msg-user">
          <div class="ai-msg-label">🙋 你问：</div>
          <div class="ai-msg-text">${escapeHtml(truncateText(msg.content, 200))}</div>
        </div>
      `;
    } else if (msg.role === 'assistant') {
      html += `
        <div class="ai-msg-assistant">
          <div class="ai-msg-label">🤖 AI 回答：</div>
          <div class="ai-msg-text">${markdownToHtml(msg.content)}</div>
        </div>
      `;
    }
  }

  // 如果正在流式输出，显示尚未保存的实时内容
  if (streamingContent !== null && streamingContent.length > 0) {
    html += `
      <div class="ai-msg-assistant">
        <div class="ai-msg-label">🤖 AI 正在回答...</div>
        <div class="ai-msg-text">${markdownToHtml(streamingContent)}</div>
      </div>
    `;
  } else if (isStreaming && streamingContent === '') {
    // 刚开始流式输出，还没收到内容
    html += `
      <div class="ai-msg-assistant">
        <div class="ai-msg-label">🤖 AI 正在回答...</div>
        <div class="ai-msg-text"><span class="ai-loading-dots">思考中<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span></div>
      </div>
    `;
  }

  contentDiv.innerHTML = html;
}

// ============================
// 面板 UI 创建（含底部输入框）
// ============================
function createPanel() {
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'ai-code-explainer-panel';
  panel.innerHTML = `
    <div class="ai-panel-header" id="ai-panel-header">
      <span class="ai-panel-title">🤖 AI 代码解释</span>
      <div class="ai-panel-actions">
        <button class="ai-btn-copy" id="ai-btn-copy" title="复制对话">📋</button>
        <button class="ai-btn-close" id="ai-btn-close" title="关闭">✕</button>
      </div>
    </div>
    <div class="ai-panel-content" id="ai-panel-content">
      <!-- 对话渲染区域 -->
    </div>
    <div class="ai-panel-footer">
      <div class="ai-input-row">
        <input 
          type="text" 
          id="ai-question-input" 
          class="ai-question-input" 
          placeholder="继续追问，深入了解代码细节..."
          autocomplete="off"
        />
        <button id="ai-send-btn" class="ai-send-btn" title="发送">➤</button>
      </div>
    </div>
    <div class="ai-resize-handle" id="ai-resize-handle"></div>
  `;

  // 样式属性
  panel.style.position = 'fixed';
  panel.style.top = '50px';
  panel.style.right = '20px';
  panel.style.width = '450px';
  panel.style.minHeight = '300px';
  panel.style.maxHeight = '75vh';
  panel.style.zIndex = '2147483647';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';

  document.body.appendChild(panel);

  // 绑定事件
  document.getElementById('ai-btn-close').addEventListener('click', closePanel);
  document.getElementById('ai-btn-copy').addEventListener('click', copyConversation);
  document.getElementById('ai-btn-close').addEventListener('click', closePanel);
  document.getElementById('ai-panel-header').addEventListener('mousedown', onDragStart);
  document.getElementById('ai-resize-handle').addEventListener('mousedown', onResizeStart);
  document.getElementById('ai-send-btn').addEventListener('click', handleSendQuestion);

  // 输入框回车发送
  const inputEl = document.getElementById('ai-question-input');
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendQuestion();
    }
  });

  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('mousemove', onDragOrResize);

  isPanelVisible = true;
}

// ============================
// 面板操作：关闭、复制、滚动
// ============================
function closePanel() {
  if (panel) {
    panel.remove();
    panel = null;
  }
  isPanelVisible = false;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  isStreaming = false;
  conversationHistory = [];
  currentAssistantContent = '';
  window.removeEventListener('mouseup', onDragEnd);
  window.removeEventListener('mousemove', onDragOrResize);
}

function copyConversation() {
  let text = '';
  for (const msg of conversationHistory) {
    if (msg.role === 'user') text += '🙋 提问：\n' + msg.content + '\n\n';
    if (msg.role === 'assistant') text += '🤖 回答：\n' + msg.content + '\n\n';
  }
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('ai-btn-copy');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }
  }).catch(err => alert('复制失败: ' + err));
}

function scrollToBottom() {
  const contentDiv = document.getElementById('ai-panel-content');
  if (contentDiv) {
    contentDiv.scrollTop = contentDiv.scrollHeight;
  }
}

// ============================
// 拖拽与调整大小
// ============================
function onDragStart(e) {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
  dragData = {
    type: 'move',
    startX: e.clientX,
    startY: e.clientY,
    panelLeft: panel.offsetLeft,
    panelTop: panel.offsetTop,
  };
  e.preventDefault();
}

function onResizeStart(e) {
  dragData = {
    type: 'resize',
    startX: e.clientX,
    startY: e.clientY,
    panelWidth: panel.offsetWidth,
    panelHeight: panel.offsetHeight,
  };
  e.preventDefault();
  e.stopPropagation();
}

function onDragEnd() {
  dragData = null;
}

function onDragOrResize(e) {
  if (!dragData || !panel) return;
  if (dragData.type === 'move') {
    const dx = e.clientX - dragData.startX;
    const dy = e.clientY - dragData.startY;
    panel.style.left = (dragData.panelLeft + dx) + 'px';
    panel.style.top = (dragData.panelTop + dy) + 'px';
    panel.style.right = 'auto';
  } else if (dragData.type === 'resize') {
    const dx = e.clientX - dragData.startX;
    const dy = e.clientY - dragData.startY;
    panel.style.width = Math.max(350, dragData.panelWidth + dx) + 'px';
    panel.style.height = Math.max(250, dragData.panelHeight + dy) + 'px';
  }
}

// ============================
// 工具函数
// ============================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncateText(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function markdownToHtml(text) {
  let html = escapeHtml(text);
  // 代码块 ```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
  });
  // 行内代码 ` `
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 加粗 ** **
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // 换行
  html = html.replace(/\n/g, '<br>');
  return html;
}