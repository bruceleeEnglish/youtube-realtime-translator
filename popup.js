document.addEventListener('DOMContentLoaded', function() {
  const toggleButton = document.getElementById('toggleTranslation');
  const saveConfigButton = document.getElementById('saveConfig');
  const targetLangSelect = document.getElementById('targetLang');
  const statusDiv = document.getElementById('status');
  const deepseekApiKeyInput = document.getElementById('deepseekApiKey');
  const deeplxApiInput = document.getElementById('deeplxApi');

  // 加载保存的配置
  chrome.storage.local.get(['isEnabled', 'targetLang', 'apiConfig'], function(result) {
    if (result.isEnabled) {
      toggleButton.textContent = '关闭同声传译';
      toggleButton.classList.add('active');
    }
    if (result.targetLang) {
      targetLangSelect.value = result.targetLang;
    }
    if (result.apiConfig) {
      deepseekApiKeyInput.value = result.apiConfig.deepseekApiKey || '';
      deeplxApiInput.value = result.apiConfig.deeplxApi || '';
    }
  });

  // 保存API配置
  saveConfigButton.addEventListener('click', function() {
    const apiConfig = {
      deepseekApiKey: deepseekApiKeyInput.value.trim(),
      deeplxApi: deeplxApiInput.value.trim()
    };

    // 验证配置
    if (!apiConfig.deepseekApiKey || !apiConfig.deeplxApi) {
      statusDiv.textContent = '请填写所有API配置信息';
      statusDiv.style.color = 'red';
      return;
    }

    chrome.storage.local.set({ apiConfig }, function() {
      statusDiv.textContent = '配置已保存';
      statusDiv.style.color = 'green';
      setTimeout(() => {
        statusDiv.textContent = '';
      }, 2000);
    });
  });

  // 切换翻译状态
  toggleButton.addEventListener('click', function() {
    chrome.storage.local.get(['isEnabled', 'apiConfig'], function(result) {
      if (!result.apiConfig || !result.apiConfig.deepseekApiKey || !result.apiConfig.deeplxApi) {
        statusDiv.textContent = '请先配置并保存API信息';
        statusDiv.style.color = 'red';
        return;
      }

      const newState = !result.isEnabled;
      chrome.storage.local.set({
        isEnabled: newState,
        targetLang: targetLangSelect.value
      });

      toggleButton.textContent = newState ? '关闭同声传译' : '开启同声传译';
      
      // 向content script发送消息
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0].url.includes('youtube.com/watch')) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'toggleTranslation',
            isEnabled: newState,
            targetLang: targetLangSelect.value,
            apiConfig: result.apiConfig
          });
        } else {
          statusDiv.textContent = '请在YouTube视频页面使用此插件';
          statusDiv.style.color = 'red';
        }
      });
    });
  });

  // 语言选择变化时保存设置
  targetLangSelect.addEventListener('change', function() {
    chrome.storage.local.set({
      targetLang: targetLangSelect.value
    });
    
    // 如果翻译已启用，则通知content script更新语言
    chrome.storage.local.get(['isEnabled', 'apiConfig'], function(result) {
      if (result.isEnabled) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0].url.includes('youtube.com/watch')) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'updateLanguage',
              targetLang: targetLangSelect.value,
              apiConfig: result.apiConfig
            });
          }
        });
      }
    });
  });
}); 