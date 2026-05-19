// background.js - 扩展后台服务

// 扩展安装或更新时触发一次
chrome.runtime.onInstalled.addListener(() => {
  // 创建右键菜单项，只在选中文本时出现
  chrome.contextMenus.create({
    id: 'ai-explain-code',
    title: '🤖 AI 代码解释',
    contexts: ['selection'],   // 选中文字才会显示
  });
  console.log('右键菜单已创建');
});

// 监听右键菜单点击事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
  // 确保是我们创建的菜单项，并且有选中的文字
  if (info.menuItemId === 'ai-explain-code' && info.selectionText) {
    // 向当前标签页注入的 content.js 发送消息
    chrome.tabs.sendMessage(tab.id, {
      action: 'explainCode',
      selectedText: info.selectionText,
    }).catch((err) => {
      // 如果当前页面没有 content script（比如 chrome:// 页面或扩展商店页），忽略错误
      console.warn('无法向该页面发送消息（可能未注入 content script）:', err);
    });
  }
});