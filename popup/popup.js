// popup.js - 管理 API Key 和 Base URL 的保存与读取

// DOM 元素
const apiKeyInput = document.getElementById('api-key');
const apiBaseInput = document.getElementById('api-base');
const saveBtn = document.getElementById('save-btn');
const clearBtn = document.getElementById('clear-btn');
const statusDiv = document.getElementById('status');

// 页面加载时，从 storage 读取已保存的设置
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const result = await chrome.storage.local.get(['apiKey', 'apiBase']);
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }
    if (result.apiBase) {
      apiBaseInput.value = result.apiBase;
    } else {
      // 默认显示 DeepSeek 的 base URL
      apiBaseInput.value = 'https://api.deepseek.com/v1';
    }
  } catch (error) {
    console.error('读取设置失败:', error);
  }
});

// 保存按钮点击事件
saveBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const apiBase = apiBaseInput.value.trim() || 'https://api.deepseek.com/v1';

  // 简单校验：Key 不能为空，且应该以 sk- 开头（DeepSeek 风格）或长度足够
  if (!apiKey) {
    showStatus('❌ API Key 不能为空', 'error');
    return;
  }
  if (apiKey.length < 10) {
    showStatus('⚠️ API Key 似乎不完整，请检查', 'warning');
    return;
  }

  try {
    await chrome.storage.local.set({ apiKey, apiBase });
    showStatus('✅ 设置已保存', 'success');
  } catch (error) {
    console.error('保存失败:', error);
    showStatus('❌ 保存失败，请重试', 'error');
  }
});

// 清除按钮点击事件
clearBtn.addEventListener('click', async () => {
  try {
    await chrome.storage.local.remove(['apiKey', 'apiBase']);
    apiKeyInput.value = '';
    apiBaseInput.value = 'https://api.deepseek.com/v1';
    showStatus('🗑️ 设置已清除', 'success');
  } catch (error) {
    console.error('清除失败:', error);
    showStatus('❌ 清除失败', 'error');
  }
});

// 显示状态提示
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  // 3 秒后自动消失
  setTimeout(() => {
    statusDiv.textContent = '';
    statusDiv.className = 'status';
  }, 3000);
}