/* =========================================================
   小手机 · 摄像头权限
   ---------------------------------------------------------
   设计原则（按用户要求）：
   1) AI 可以「申请」摄像头权限 —— 他会在聊天里发一条带
      「允许 / 拒绝」按钮的请求；
   2) **每次都要申请，每次都要你点同意** —— 不记住、不自动放行，
      哪怕上一秒刚同意过，下一次仍然要重新点；
   3) 你同意后才真正调 navigator.mediaDevices.getUserMedia
      打开摄像头，画面只在本机预览，不上传任何地方。

   一条完整链路：
     AI 申请 → 用户在聊天里点「允许」→ 系统权限弹窗（首次）
     → 摄像头画面出现在聊天里 → 用户可以随时关掉
   ========================================================= */

const Camera = (() => {

  /* 当前活动流：同一时刻只允许一个摄像头会话 */
  let stream = null;
  let activeId = null;          /* 正在用摄像头的角色 id */
  let panelEl = null;
  let shots = [];               /* 本次会话拍下的照片（dataURL） */

  /* ---------------- 能力检测 ---------------- */
  function supported(){
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  function isSecure(){
    const p = location.protocol;
    return p === 'https:' || location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1' || location.hostname === '::1';
  }
  function isOpen(){ return !!stream; }

  /* ---------------- 打开 / 关闭 ---------------- */

  /* 真正向浏览器要权限并开流。
     注意：**每次调用都重新 getUserMedia**，浏览器该弹系统授权
     就会弹；即便系统层面已授权，我们依然要求应用内先点同意。 */
  async function open(charId, opts){
    opts = opts || {};
    if (!supported()){
      throw new Error('这个浏览器不支持调用摄像头。');
    }
    if (!isSecure()){
      throw new Error('浏览器只允许在 https 或 localhost 下使用摄像头。');
    }

    /* 先关掉上一个会话，避免多个流同时占着指示灯 */
    close();

    const constraints = {
      video: opts.facing === 'environment'
        ? { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    };

    try{
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    }catch(err){
      stream = null;
      throw new Error(explain(err));
    }

    activeId = charId || null;
    shots = [];
    render();
    Phone.haptic(14);
    return stream;
  }

  function close(){
    if (stream){
      try{ stream.getTracks().forEach(t => t.stop()); }catch(e){}
    }
    stream = null;
    activeId = null;
    shots = [];
    if (panelEl){ panelEl.remove(); panelEl = null; }
  }

  /* 把 getUserMedia 的报错翻成人话 */
  function explain(err){
    const n = (err && (err.name || '')) + ' ' + ((err && err.message) || '');
    if (/NotAllowedError|PermissionDenied/i.test(n)) return '你拒绝了摄像头权限。想用的话，在浏览器地址栏的权限图标里重新允许。';
    if (/NotFoundError|DevicesNotFound/i.test(n)) return '没找到摄像头设备。';
    if (/NotReadableError|TrackStartError/i.test(n)) return '摄像头被别的程序占用了，关掉其它用摄像头的软件再试。';
    if (/OverconstrainedError/i.test(n)) return '摄像头不支持这个分辨率。';
    if (/SecurityError/i.test(n)) return '浏览器安全策略拦住了摄像头（需要 https 或 localhost）。';
    return '打不开摄像头：' + ((err && err.message) || '未知错误');
  }

  /* ---------------- 预览面板 ---------------- */

  function render(){
    if (!stream) return;
    if (panelEl){ panelEl.remove(); panelEl = null; }

    const c = activeId ? Phone.char(activeId) : null;
    const scr = document.querySelector('.screen') || document.body;

    const o = document.createElement('div');
    o.className = 'cam-overlay';
    o.innerHTML = `
      <div class="cam-panel" style="--c1:${c ? c.c1 : '#ff5f8d'};--c2:${c ? c.c2 : '#8b5cf6'}">
        <div class="cam-hd">
          <span class="cam-dot"></span>
          <span class="cam-title">${c ? Phone.escapeHtml(c.name) + ' 正在看你' : '摄像头'}</span>
          <button class="cam-x" id="cam-close" aria-label="关闭">${Icons.svg('close', 18)}</button>
        </div>
        <div class="cam-stage">
          <video class="cam-video" id="cam-video" autoplay playsinline muted></video>
          <div class="cam-badge">● 本机预览 · 不上传</div>
        </div>
        <div class="cam-acts">
          <button class="cam-btn" id="cam-shot">${Icons.svg('camera', 18)}<span>拍一张</span></button>
          <button class="cam-btn" id="cam-flip">${Icons.svg('refresh', 18)}<span>翻转</span></button>
          <button class="cam-btn danger" id="cam-stop">${Icons.svg('close', 18)}<span>关掉</span></button>
        </div>
        <div class="cam-strip" id="cam-strip"></div>
      </div>`;
    scr.appendChild(o);
    panelEl = o;

    const v = o.querySelector('#cam-video');
    v.srcObject = stream;
    v.play().catch(()=>{});

    o.querySelector('#cam-close').onclick = () => { close(); Phone.toast('摄像头已关闭'); };
    o.querySelector('#cam-stop').onclick  = () => { close(); Phone.toast('摄像头已关闭'); };
    o.querySelector('#cam-shot').onclick  = () => snapshot();
    o.querySelector('#cam-flip').onclick  = () => flip();

    /* 点遮罩关闭 */
    o.addEventListener('click', e => { if (e.target === o){ close(); Phone.toast('摄像头已关闭'); } });
  }

  /* 翻转前后摄像头 */
  async function flip(){
    if (!stream) return;
    const cur = stream.getVideoTracks()[0];
    const s = cur && cur.getSettings ? cur.getSettings() : {};
    const next = (s.facingMode === 'environment') ? 'user' : 'environment';
    const id = activeId;
    try{
      await open(id, { facing: next });
    }catch(e){
      Phone.toast(e.message);
    }
  }

  /* 拍一张：把当前帧画到 canvas，存成 dataURL */
  function snapshot(){
    const v = panelEl && panelEl.querySelector('#cam-video');
    if (!v) return null;
    const w = v.videoWidth || 640, h = v.videoHeight || 480;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(v, 0, 0, w, h);
    let url;
    try{ url = cv.toDataURL('image/jpeg', 0.82); }
    catch(e){ Phone.toast('截帧失败'); return null; }
    shots.push(url);
    Phone.haptic(12);
    Phone.sendSfx();

    /* 缩略图条 */
    const strip = panelEl.querySelector('#cam-strip');
    const th = document.createElement('div');
    th.className = 'cam-thumb';
    th.style.backgroundImage = `url("${url}")`;
    strip.appendChild(th);
    strip.scrollLeft = strip.scrollWidth;

    /* 把「他看到的画面」作为一条消息推进聊天（图片气泡） */
    if (activeId){
      Chat.push(activeId, {
        t: 'text',
        from: 'me',
        v: '（你让他看了一眼摄像头）',
        _camShot: url,          /* 附带的照片，气泡里显示 */
        at: Date.now()
      });
      /* 让他对看到的画面回一句话 */
      setTimeout(()=>{
        if (!activeId) return;
        const line = shotComment();
        Chat.push(activeId, { t:'text', v: line, from:'ta', at: Date.now() });
        Phone.blurp();
        Phone.haptic(12);
      }, 700 + Math.random()*700);
    }
    Phone.toast('已拍下，他看到啦');
    return url;
  }

  /* 拍完照后他的反应（本地引擎也有一点"看了画面"的感觉） */
  function shotComment(){
    const pool = [
      '……嗯，我看到了。', '头发有点乱。', '别凑那么近，看不清你了。',
      '把镜头拉远点。', '这光太暗了，开个灯。', '……你笑什么。',
      '行了，收起来吧。', '就这样看你一会儿。'
    ];
    return pool[Math.floor(Math.random()*pool.length)];
  }

  return {
    supported, isSecure, isOpen, open, close, snapshot, shots: () => shots.slice(),
    get activeId(){ return activeId; }
  };
})();

window.Camera = Camera;


/* =========================================================
   摄像头权限申请（AI 发起 → 用户逐次同意）
   ---------------------------------------------------------
   这是「每次都要申请」的执行者：
   - AI 想用摄像头时调 Camera.ask(charId, reason)；
   - 聊天里出现一条系统请求气泡，按钮是「允许」/「拒绝」；
   - 用户点「允许」才去调 Camera.open()（浏览器系统权限弹窗）；
   - 点「拒绝」就记一条婉拒回复，什么都不会打开。
   不缓存同意状态，所以每次都必须重新点。
   ========================================================= */

const CamPermission = (() => {

  /* AI 侧：发起一次申请 */
  function ask(charId, reason){
    const c = Phone.char(charId);
    const rid = 'camreq_' + Date.now().toString(36);
    const line = reason || pickReason(c);

    Chat.push(charId, {
      t: 'text',
      from: 'ta',
      v: line,
      _camRequest: rid,        /* 标记：这条气泡要渲染成带按钮的权限请求 */
      at: Date.now()
    });
    Phone.banner(charId, '想看看你', 'call');
    Phone.haptic(18);
    return rid;
  }

  /* 他提出这个请求时会说的话 */
  function pickReason(c){
    const pool = [
      '开一下摄像头，我想看看你现在什么样。',
      '把摄像头给我一下，就一秒。',
      '让我看看你。别拒绝。',
      '有点不放心，开个摄像头我确认下你在家。',
      '想你了。摄像头开一下。'
    ];
    return pool[Math.floor(Math.random()*pool.length)];
  }

  /* 用户点「允许」——先弹一道应用内确认，再走系统权限 */
  async function grant(charId, rid){
    /* 明确告知，且**每次都问** */
    const ok = await UI.confirm({
      title: '允许使用摄像头？',
      text: '他会通过摄像头看你。画面只在本机显示，不会上传。\n（每次使用都需要你重新同意）',
      okText: '允许一次',
      cancelText: '不允许'
    });
    if (!ok){ deny(charId, rid); return false; }

    try{
      await Camera.open(charId, {});
      markResolved(charId, rid, 'granted');
      Chat.push(charId, { t:'text', v:'（摄像头已打开）', from:'me', at: Date.now() });
      setTimeout(()=>{
        Chat.push(charId, { t:'text', v:'……嗯，看到了。', from:'ta', at: Date.now() });
        Phone.blurp();
      }, 800);
      Phone.toast('摄像头已打开');
      return true;
    }catch(e){
      markResolved(charId, rid, 'failed');
      Chat.push(charId, { t:'text', v:'（摄像头打不开：' + e.message + '）', from:'me', at: Date.now() });
      setTimeout(()=>{
        Chat.push(charId, { t:'text', v:'……算了。', from:'ta', at: Date.now() });
      }, 700);
      Phone.toast(e.message);
      return false;
    }
  }

  /* 用户点「拒绝」 */
  function deny(charId, rid){
    markResolved(charId, rid, 'denied');
    Chat.push(charId, { t:'text', v:'（你拒绝了摄像头）', from:'me', at: Date.now() });
    setTimeout(()=>{
      const c = Phone.char(charId);
      const pool = ['……行。', '不问你要了。', '嗯，我知道了。', '算了。'];
      Chat.push(charId, { t:'text', v: pool[Math.floor(Math.random()*pool.length)], from:'ta', at: Date.now() });
      Phone.blurp();
    }, 600);
    Phone.toast('已拒绝，摄像头没有打开');
  }

  /* 把请求气泡标记成「已处理」，按钮消失，避免重复点击 */
  function markResolved(charId, rid, result){
    const s = Phone.st(charId);
    const m = s.msgs.find(x => x._camRequest === rid);
    if (m){
      m._camResult = result;
      delete m._camRequest;
      Phone.save();
    }
    /* 立刻刷新那条气泡 */
    Chat.renderAll();
  }

  return { ask, grant, deny };
})();

window.CamPermission = CamPermission;
