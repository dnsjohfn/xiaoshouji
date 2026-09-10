/* =========================================================
   小手机 · 通话语音转文字
   ---------------------------------------------------------
   目标：打电话时，把你说的话转成文字，AI 据此用文字回复，
        回复内容显示在通话界面上（不发声、不合成语音）。

   用浏览器原生的 SpeechRecognition（Chrome/Edge/Safari 支持，
   无需任何 API key），持续监听：
     - 说话中 → 通话界面底部出现「听你说…」+ 实时转写
     - 停顿断句 → 这半句定稿，作为一句「你：xxx」进字幕
     - 定稿后 → 调 Engine.reply 拿他的回复，以文字进字幕
     - 识别结束会自动重启，直到挂断
   ========================================================= */

const CallVoice = (() => {

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let recog = null;
  let running = false;        /* 用户是否开着语音转文字 */
  let wantRestart = false;    /* 识别意外结束时是否要自动重启 */
  let targetChar = null;      /* 当前通话角色 id */
  let busy = false;           /* 正在等他的回复，避免连发 */
  let lastFinal = '';         /* 上一句定稿，防重复 */
  let lastFinalAt = 0;
  let autoStarted = false;    /* 是不是通话接通时自动开的 */

  /* 回调：由 Call 注入，负责往字幕里写东西 */
  let hooks = {
    onInterim: null,   /* (text) 实时转写 */
    onYou: null,       /* (text) 你说的一句定稿 */
    onReply: null,     /* (text) 他的文字回复 */
    onState: null      /* (on) 开关状态变化 */
  };

  function supported(){ return !!SR; }

  function setHooks(h){ hooks = Object.assign(hooks, h || {}); }

  /* ---------- 启动 / 停止 ---------- */

  function start(charId, opts){
    if (!supported()) return false;
    if (running) return true;
    targetChar = charId;
    running = true;
    wantRestart = true;
    busy = false;
    lastFinal = '';
    autoStarted = !!(opts && opts.auto);
    spawn();
    if (hooks.onState) hooks.onState(true);
    return true;
  }

  function stop(){
    running = false;
    wantRestart = false;
    if (hooks.onState) hooks.onState(false);
    if (recog){
      try{ recog.onend = null; recog.stop(); }catch(e){}
      recog = null;
    }
  }

  function isRunning(){ return running; }
  function setTarget(id){ targetChar = id; }

  /* 创建并启动一个识别实例 */
  function spawn(){
    if (!running || !SR) return;
    try{
      recog = new SR();
      recog.lang = 'zh-CN';
      recog.continuous = true;      /* 通话里要一直听 */
      recog.interimResults = true;  /* 要实时转写 */
      recog.maxAlternatives = 1;

      recog.onresult = onResult;
      recog.onerror = onError;
      recog.onend = onEnd;

      recog.start();
      /* 有些浏览器在"非用户手势"里 start 会立刻抛错/立刻 end。
         如果自动启动失败，挂一次性的交互监听，等用户点/摸屏幕时重启。 */
      if (autoStarted) armGestureRetry();
    }catch(e){
      /* 有些浏览器不允许重复 start，稍后重试 */
      if (autoStarted) armGestureRetry();
      setTimeout(() => { if (running) spawn(); }, 600);
    }
  }

  /* 自动启动被浏览器拦下时，等第一次交互再拉起来（一次性） */
  let gestureArmed = false;
  function armGestureRetry(){
    if (gestureArmed) return;
    gestureArmed = true;
    const retry = () => {
      document.removeEventListener('pointerdown', retry, true);
      document.removeEventListener('touchstart', retry, true);
      document.removeEventListener('click', retry, true);
      gestureArmed = false;
      if (running && !recog){ spawn(); }
      else if (running){ /* 已经在跑，不用管 */ }
    };
    document.addEventListener('pointerdown', retry, true);
    document.addEventListener('touchstart', retry, true);
    document.addEventListener('click', retry, true);
  }

  /* 识别到一句话（可能还没说完） */
  function onResult(ev){
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++){
      const r = ev.results[i];
      const txt = (r[0] && r[0].transcript || '').trim();
      if (!txt) continue;
      if (r.isFinal){
        handleFinal(txt);
      } else {
        interim += txt;
      }
    }
    if (hooks.onInterim) hooks.onInterim(interim);
  }

  /* 一句说完 → 进字幕 + 让他回 */
  function handleFinal(text){
    text = String(text || '').trim();
    if (!text) return;

    /* 防重复：同内容短时间内只算一次 */
    const now = Date.now();
    if (text === lastFinal && now - lastFinalAt < 2500) return;
    lastFinal = text; lastFinalAt = now;

    if (hooks.onInterim) hooks.onInterim('');
    if (hooks.onYou) hooks.onYou(text);

    /* 他根据这句话回文字 */
    if (hooks.onReply){
      replyTo(text).then(line => {
        if (line && hooks.onReply) hooks.onReply(line);
      });
    }
  }

  /* 用引擎生成他的回复（复用和聊天完全一样的引擎：在线模型 / 本地兜底） */
  async function replyTo(text){
    if (busy) return '';
    busy = true;
    try{
      const id = targetChar;
      const c = Phone.char(id);
      /* 给他一点上下文：把通话字幕里最近几句拼进去 */
      const hist = [];
      try{
        const cap = document.getElementById('call-caption');
        if (cap){
          const lines = Array.from(cap.querySelectorAll('.cc')).slice(-6);
          lines.forEach(el => {
            const t = (el.textContent || '').replace(/^[^：]*：/, '').trim();
            if (t) hist.push({ role: /^\s*你/.test(el.textContent || '') ? 'user' : 'assistant', content: t });
          });
        }
      }catch(e){}

      let r;
      try{
        r = await Engine.reply(c, hist, text);
      }catch(e){
        r = { t: 'text', v: '（信号不太好……你再说一遍？）' };
      }
      let v = String(r && r.v || '').trim();
      /* 通话里只用文字：语音条转成它的文字内容 */
      if (r && r.t === 'voice' && r.text) v = String(r.text).trim();
      return v;
    } finally {
      busy = false;
    }
  }

  function onError(ev){
    const err = (ev && ev.error) || '';
    /* 用户没说话 / 网络抖动很常见，静默重试即可 */
    if (err === 'no-speech' || err === 'aborted' || err === 'network') return;
    if (err === 'not-allowed' || err === 'service-not-allowed'){
      running = false; wantRestart = false;
      if (hooks.onState) hooks.onState(false);
      if (window.Phone){
        Phone.toast(autoStarted
          ? '没拿到麦克风权限，点一下 🎙️ 可以再试'
          : '没有麦克风权限，语音转文字停下了');
      }
      return;
    }
    /* 其它错误：如果是 busy 之类的，停下别死循环 */
    if (err === 'audio-capture'){
      running = false; wantRestart = false;
      if (hooks.onState) hooks.onState(false);
      if (window.Phone) Phone.toast('没找到麦克风');
    }
  }

  function onEnd(){
    /* 识别会因为静默超时等原因自己结束，通话中要接着听 */
    if (running && wantRestart){
      setTimeout(() => { if (running) spawn(); }, 320);
    }
  }

  return {
    supported, start, stop, isRunning, setTarget, setHooks,
    get listening(){ return running; }
  };
})();

window.CallVoice = CallVoice;
