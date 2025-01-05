class YouTubeTranslator {
  constructor() {
    this.isEnabled = false;
    this.targetLang = 'zh';
    this.subtitles = null;
    this.processedSubtitles = null;
    this.translationDiv = null;
    this.progressDiv = null;
    this.currentVideoId = null;
    this.speechSynth = window.speechSynthesis;
    this.currentUtterance = null;
    this.lastSubtitleId = null;
    this.translationCache = new Map();
    this.utteranceCache = new Map();
    this.nextSubtitleTimeout = null;
    this.apiConfig = null;
    this.init();
  }

  init() {
    this.createTranslationUI();
    this.createProgressUI();
    this.setupMessageListener();
    this.setupVideoObserver();
    console.log('YouTube Translator initialized');
  }

  createTranslationUI() {
    this.translationDiv = document.createElement('div');
    this.translationDiv.style.cssText = `
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 10px 20px;
      border-radius: 4px;
      z-index: 9999;
      font-size: 16px;
      max-width: 80%;
      text-align: center;
      display: none;
    `;
    document.body.appendChild(this.translationDiv);
  }

  createProgressUI() {
    this.progressDiv = document.createElement('div');
    this.progressDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px;
      border-radius: 8px;
      z-index: 10000;
      text-align: center;
      display: none;
    `;
    
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      width: 300px;
      height: 20px;
      background: #444;
      border-radius: 10px;
      overflow: hidden;
      margin: 10px 0;
    `;
    
    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
      width: 0%;
      height: 100%;
      background: #4CAF50;
      transition: width 0.3s;
    `;
    
    const progressText = document.createElement('div');
    progressText.textContent = '正在处理字幕...';
    
    progressBar.appendChild(progressFill);
    this.progressDiv.appendChild(progressText);
    this.progressDiv.appendChild(progressBar);
    document.body.appendChild(this.progressDiv);
    
    this.progressBar = progressFill;
    this.progressText = progressText;
  }

  updateProgress(percent, text) {
    this.progressBar.style.width = `${percent}%`;
    if (text) {
      this.progressText.textContent = text;
    }
  }

  async processSubtitlesWithAI(subtitles) {
    if (!this.apiConfig) {
      console.error('No API configuration found');
      return subtitles;
    }

    const mergedSubtitles = this.mergeSubtitles(subtitles);
    const processedSubtitles = [];
    
    for (let i = 0; i < mergedSubtitles.length; i++) {
      const subtitle = mergedSubtitles[i];
      try {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiConfig.deepseekApiKey}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: '你是一个专业的同声传译员（尤其对数学和计算机专业的视频）。请将以下英文字幕翻译成简短流畅的中文，保持语义完整性。翻译要简洁，每句话不要超过20个字。注意语序要符合中文习惯。'
              },
              {
                role: 'user',
                content: subtitle.text
              }
            ],
            temperature: 0.3
          })
        });

        const data = await response.json();
        const translatedText = data.choices[0].message.content.trim();
        
        const baseRate = this.calculateSpeechRate(translatedText, subtitle.duration);
        
        const utterance = new SpeechSynthesisUtterance(translatedText);
        utterance.lang = this.targetLang === 'zh' ? 'zh-CN' : this.targetLang;
        utterance.rate = baseRate;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        utterance.onend = () => {
          console.log('Speech finished for:', translatedText);
        };
        
        processedSubtitles.push({
          ...subtitle,
          translatedText: translatedText,
          utterance: utterance,
          baseRate: baseRate
        });

        const progress = Math.min(((i + 1) / mergedSubtitles.length) * 100, 100);
        this.updateProgress(progress, `正在处理字幕... ${Math.round(progress)}%`);
        
      } catch (error) {
        console.error('AI processing error:', error);
        const translatedText = await this.translateText(subtitle.text);
        const baseRate = this.calculateSpeechRate(translatedText, subtitle.duration);
        
        const utterance = new SpeechSynthesisUtterance(translatedText.trim());
        utterance.lang = this.targetLang === 'zh' ? 'zh-CN' : this.targetLang;
        utterance.rate = baseRate;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        processedSubtitles.push({
          ...subtitle,
          translatedText: translatedText.trim(),
          utterance: utterance,
          baseRate: baseRate
        });
      }
    }

    return processedSubtitles;
  }

  calculateSpeechRate(text, duration) {
    const estimatedDuration = text.length * 0.3;
    const rate = estimatedDuration / duration;
    
    return Math.min(Math.max(rate, 0.8), 2.0);
  }

  mergeSubtitles(subtitles) {
    const mergedSubtitles = [];
    let currentSubtitle = null;
    
    for (const subtitle of subtitles) {
      if (!currentSubtitle) {
        currentSubtitle = { ...subtitle };
        continue;
      }

      const timeDiff = subtitle.start - (currentSubtitle.start + currentSubtitle.duration);
      const currentEndsWithPunctuation = /[.!?。！？]$/.test(currentSubtitle.text);
      const combinedDuration = subtitle.start + subtitle.duration - currentSubtitle.start;
      
      if (timeDiff < 0.2 && !currentEndsWithPunctuation && combinedDuration <= 4) {
        currentSubtitle.duration = combinedDuration;
        currentSubtitle.text += ' ' + subtitle.text;
      } else {
        mergedSubtitles.push(currentSubtitle);
        currentSubtitle = { ...subtitle };
      }
    }
    
    if (currentSubtitle) {
      mergedSubtitles.push(currentSubtitle);
    }

    return mergedSubtitles;
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Received message:', message);
      if (message.action === 'toggleTranslation') {
        this.isEnabled = message.isEnabled;
        this.targetLang = message.targetLang;
        this.apiConfig = message.apiConfig;
        if (this.isEnabled) {
          this.startTranslation();
        } else {
          this.stopTranslation();
        }
      } else if (message.action === 'updateLanguage') {
        this.targetLang = message.targetLang;
        this.apiConfig = message.apiConfig;
        if (this.isEnabled) {
          this.startTranslation();
        }
      }
    });
  }

  setupVideoObserver() {
    const observer = new MutationObserver(() => {
      const video = document.querySelector('video');
      if (video && !video.dataset.translatorInitialized) {
        video.dataset.translatorInitialized = 'true';
        this.setupVideoListeners(video);
        console.log('Video element found and initialized');
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  setupVideoListeners(video) {
    if (this.isEnabled && !this.processedSubtitles) {
      video.pause();
    }

    video.addEventListener('timeupdate', () => {
      if (this.isEnabled && this.processedSubtitles) {
        this.updateTranslation(video.currentTime);
      }
    });

    video.addEventListener('pause', () => {
      if (this.currentUtterance) {
        this.speechSynth.cancel();
      }
    });

    video.addEventListener('play', () => {
      if (this.currentUtterance && this.isEnabled) {
        this.speechSynth.speak(this.currentUtterance);
      }
    });
  }

  async startTranslation() {
    console.log('Starting translation...');
    const videoId = this.getVideoId();
    const video = document.querySelector('video');
    
    if (videoId !== this.currentVideoId) {
      this.currentVideoId = videoId;
      
      this.progressDiv.style.display = 'block';
      if (video) video.pause();
      
      this.subtitles = await this.fetchSubtitles(videoId);
      if (this.subtitles) {
        this.processedSubtitles = await this.processSubtitlesWithAI(this.subtitles);
      }
      
      this.progressDiv.style.display = 'none';
      if (video) video.play();
    }
    
    this.translationDiv.style.display = 'block';
  }

  stopTranslation() {
    this.translationDiv.style.display = 'none';
    this.progressDiv.style.display = 'none';
    if (this.currentUtterance) {
      this.speechSynth.cancel();
    }
    if (this.nextSubtitleTimeout) {
      clearTimeout(this.nextSubtitleTimeout);
      this.nextSubtitleTimeout = null;
    }
    this.lastSubtitleId = null;
    this.translationCache.clear();
    this.utteranceCache.clear();
  }

  getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  async fetchSubtitles(videoId) {
    try {
      console.log('Fetching subtitles for video:', videoId);
      
      const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const videoPageHtml = await videoPageResponse.text();
      
      const ytInitialPlayerResponse = videoPageHtml.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)?.[1];
      if (!ytInitialPlayerResponse) {
        console.error('Failed to find ytInitialPlayerResponse');
        return null;
      }
      
      const playerData = JSON.parse(ytInitialPlayerResponse);
      const captions = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      
      if (!captions || captions.length === 0) {
        console.error('No captions found');
        return null;
      }

      const track = captions.find(t => t.languageCode === 'en') || captions[0];
      console.log('Selected caption track:', track);

      const response = await fetch(track.baseUrl);
      const xml = await response.text();
      
      const subtitles = this.parseSubtitles(xml);
      console.log('Parsed subtitles:', subtitles);
      return subtitles;
    } catch (error) {
      console.error('Error fetching subtitles:', error);
      return null;
    }
  }

  parseSubtitles(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const textNodes = doc.getElementsByTagName('text');
    
    return Array.from(textNodes).map(node => ({
      start: parseFloat(node.getAttribute('start')),
      duration: parseFloat(node.getAttribute('dur')),
      text: node.textContent.trim()
    }));
  }

  async updateTranslation(currentTime) {
    if (this.nextSubtitleTimeout) {
      clearTimeout(this.nextSubtitleTimeout);
      this.nextSubtitleTimeout = null;
    }

    const currentSubtitle = this.processedSubtitles?.find(sub => 
      currentTime >= sub.start && currentTime <= (sub.start + sub.duration)
    );

    if (currentSubtitle && currentSubtitle.translatedText) {
      const subtitleId = `${currentSubtitle.start}-${currentSubtitle.text}`;
      
      if (subtitleId === this.lastSubtitleId) {
        return;
      }
      
      this.lastSubtitleId = subtitleId;
      console.log('Current subtitle:', currentSubtitle);

      if (this.currentUtterance) {
        this.speechSynth.cancel();
      }

      this.translationDiv.textContent = currentSubtitle.translatedText;
      
      const remainingDuration = currentSubtitle.start + currentSubtitle.duration - currentTime;
      const dynamicRate = this.calculateDynamicRate(
        currentSubtitle.translatedText,
        remainingDuration,
        currentSubtitle.baseRate
      );
      
      const utterance = new SpeechSynthesisUtterance(currentSubtitle.translatedText);
      utterance.lang = this.targetLang === 'zh' ? 'zh-CN' : this.targetLang;
      utterance.rate = dynamicRate;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      
      utterance.onend = () => {
        console.log('Speech completed:', currentSubtitle.translatedText);
      };
      
      this.currentUtterance = utterance;
      this.speechSynth.speak(this.currentUtterance);

      const nextSubtitle = this.processedSubtitles.find(sub => 
        sub.start > currentSubtitle.start + currentSubtitle.duration
      );

      if (nextSubtitle) {
        const timeToNext = (nextSubtitle.start - currentTime) * 1000;
        this.nextSubtitleTimeout = setTimeout(() => {
          if (this.currentUtterance) {
            this.speechSynth.cancel();
          }
          this.updateTranslation(nextSubtitle.start);
        }, timeToNext);
      }
    } else {
      if (this.lastSubtitleId !== null) {
        this.lastSubtitleId = null;
        this.translationDiv.textContent = '';
        if (this.currentUtterance) {
          this.speechSynth.cancel();
        }
      }
    }
  }

  calculateDynamicRate(text, remainingDuration, baseRate) {
    const estimatedDuration = text.length * 0.3;
    
    if (remainingDuration < estimatedDuration) {
      const neededRate = estimatedDuration / remainingDuration;
      return Math.min(baseRate * neededRate, 2.0);
    }
    
    return baseRate;
  }

  async translateText(text) {
    if (!this.apiConfig) {
      console.error('No API configuration found');
      return text;
    }

    try {
      console.log('Translating text:', text);
      const response = await fetch(this.apiConfig.deeplxApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          source_lang: 'EN',
          target_lang: this.targetLang === 'zh' ? 'ZH' : this.targetLang.toUpperCase()
        })
      });

      const data = await response.json();
      if (data.code === 200 && data.data) {
        console.log('Translation result:', data.data);
        return data.data;
      } else {
        throw new Error('Translation failed: ' + data.message);
      }
    } catch (error) {
      console.error('Translation error:', error);
      return text;
    }
  }
}

console.log('Initializing YouTube Translator...');
new YouTubeTranslator(); 