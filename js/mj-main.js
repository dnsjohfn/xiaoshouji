/* =========================================================
   小手机 · 启动与主动消息调度
   ========================================================= */

(function boot(){

  const $ = id => document.getElementById(id);


/* =========================================================
   MOBILE-GUARD · 手机端防放大 / 防误触补丁
   1) 部分浏览器忽略 user-scalable=no → 用 JS 强制把缩放拉回 1
   2) 双击缩放兜底拦截
   3) 输入框获焦时校正视口，防止 iOS 自动 zoom
   ========================================================= */
(function mobileGuard(){

  const isTouch = ('ontouchstart' in window) ||
                  (navigator.maxTouchPoints > 0);

  /* ---- ① 强制缩放归位 ---- */
  function resetZoom(){
    if (!isTouch) return;
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    // 先移除再写回，能逼 iOS 重新计算缩放
    const base = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
    vp.setAttribute('content', base);
  }

  /* ---- ② 双击 / 双指缩放拦截 ---- */
  let lastTouch = 0, lastTapTarget = null;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    const tgt = e.target;
    const isField = tgt && (tgt.tagName === 'INPUT' ||
                            tgt.tagName === 'TEXTAREA' ||
                            tgt.tagName === 'SELECT');
    if (now - lastTouch <= 320 && !isField){
      /* 双击：拦掉第二次，并复位缩放 */
      if (e.cancelable) e.preventDefault();
      resetZoom();
      forceScaleOne();
      lastTouch = 0;
      return;
    }
    lastTouch = now;
  }, { passive: false });

  /* 双击兜底（部分安卓浏览器走 dblclick） */
  document.addEventListener('dblclick', e => {
    const t = e.target;
    const isField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (!isField){ e.preventDefault(); resetZoom(); forceScaleOne(); }
  }, { passive: false });

  /* 双指手势（Safari 私有事件） */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => {
    document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  });

  /* 多点触摸 → 禁掉双指缩放 */
  document.addEventListener('touchstart', e => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  /* 主动把缩放拉回 1（iOS Safari 忽略 user-scalable=no 时的兜底） */
  function forceScaleOne(){
    if (!isTouch) return;
    const vv = window.visualViewport;
    if (!vv) return;
    if (vv.scale > 1.02){
      /* 用一次极小的捏合复位：Safari 里改 meta 已无效，只能靠 scroll 归位 */
      window.scrollTo(vv.pageLeft || 0, vv.pageTop || 0);
      /* 再写一次 viewport，能逼部分内核重算 */
      const vp = document.querySelector('meta[name="viewport"]');
      if (vp){
        vp.setAttribute('content',
          'width=device-width,initial-scale=1,maximum-scale=1,minimum-scale=1,user-scalable=no,viewport-fit=cover');
      }
    }
  }

  /* ---- ③ 输入框获焦后校正视口 ---- */
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    // iOS 在键盘弹起后可能保留放大状态，稍后校正
    setTimeout(() => {
      resetZoom();
      // 页面被放大时（visualViewport.scale > 1）强制滚回
      const vv = window.visualViewport;
      if (vv && vv.scale > 1.02){
        window.scrollTo(0, 0);
      }
    }, 260);
  }, true);

  document.addEventListener('focusout', () => {
    setTimeout(resetZoom, 160);
  }, true);

  /* ---- ④ 页面从后台回来时也校正一次 ---- */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(resetZoom, 120);
  });

  /* ---- ⑤ 阻止 iOS 整页橡皮筋拖动（只允许内部滚动区滚） ---- */
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1){ e.preventDefault(); return; }
    let n = e.target;
    while (n && n !== document.body){
      if (n.classList && (
          n.classList.contains('chat-list') ||
          n.classList.contains('appbody') ||
          n.classList.contains('hs-grid') ||
          n.classList.contains('stream') ||
          n.classList.contains('bgpanel-body') ||
          n.classList.contains('modal-body') ||
          n.classList.contains('albwrap') ||
          n.classList.contains('npwrap') ||
          n.classList.contains('quick'))){
        return;   // 命中可滚动区，放行
      }
      n = n.parentNode;
    }
    // 不在滚动区内的拖动一律拦掉，避免整页晃
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  /* ---- ⑥ 地址栏收起时更新视口高度（补 dvh 的旧浏览器） ---- */
  function setVH(){
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty('--vh', h + 'px');
  }
  setVH();
  window.addEventListener('resize', setVH);
  window.addEventListener('orientationchange', () => setTimeout(setVH, 260));
  if (window.visualViewport){
    window.visualViewport.addEventListener('resize', setVH);
    window.visualViewport.addEventListener('scroll', setVH);
  }

  resetZoom();
})();

  Phone.init();

  /* ---------- 解锁：点击 / 上滑 / ↑ ---------- */
  const lockEl = $('lockscreen');
  let sy = null;

  lockEl.addEventListener('click', e => {
    if (e.target.closest('.notif-card') || e.target.closest('.ls-person')) return;
    Phone.unlock();
  });
  lockEl.addEventListener('touchstart', e => { sy = e.touches[0].clientY; }, {passive:true});
  lockEl.addEventListener('touchend', e => {
    const ey = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : sy;
    if (sy !== null && sy - ey > 40) Phone.unlock();
    sy = null;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && !Phone.S.unlocked) Phone.unlock();
  });

  /* ---------- 通知点了 → 直达聊天 ---------- */
  function jumpToChat(id){
    id = id || Phone.S.activeChar;
    if (!Phone.S.unlocked) Phone.unlock();
    setTimeout(()=>{ Apps.open('chat'); Chat.open(id); }, 360);
  }
  $('ls-notif-card').addEventListener('click', e => { e.stopPropagation(); jumpToChat(Phone.S.activeChar); });
  $('ls-person').addEventListener('click', e => { e.stopPropagation(); jumpToChat(Phone.S.activeChar); });
  /* 通知横幅：点开 → 直达聊天；上滑 → 划掉（iOS 手感） */
  $('banner').addEventListener('click', () => {
    const id = $('banner').dataset.char || Phone.S.activeChar;
    Phone.dismissBanner();
    jumpToChat(id);
  });
  (function bannerSwipe(){
    const b = $('banner');
    let sy = null, dx = 0;
    b.addEventListener('touchstart', e => {
      sy = e.touches[0].clientY;
      b.style.transition = 'none';
    }, { passive:true });
    b.addEventListener('touchmove', e => {
      if (sy === null) return;
      const dy = e.touches[0].clientY - sy;
      if (dy < 0){
        dx = dy;
        b.style.transform = `translateY(${dy}px) scale(${Math.max(.9, 1 + dy/1200)})`;
        b.style.opacity = String(Math.max(0, 1 + dy/180));
      }
    }, { passive:true });
    const end = () => {
      if (sy === null) return;
      sy = null;
      b.style.transition = '';
      b.style.transform = '';
      b.style.opacity = '';
      if (dx < -45) Phone.dismissBanner();   /* 上滑够远 → 划掉 */
      dx = 0;
    };
    b.addEventListener('touchend', end);
    b.addEventListener('touchcancel', end);
  })();

  /* ---------- Home 条 / 返回键 ---------- */
  /* home 条：在应用里→回桌面；在桌面→锁屏 */
  $('homebar').addEventListener('click', ()=> Phone.homeKey());
  /* 返回键：只回桌面，不锁屏 */
  $('app-back').addEventListener('click', ()=> Phone.goHome());

  /* ---------- 通话按钮 ---------- */
  $('call-hang').addEventListener('click', ()=> Call.end());
  $('call-mute').addEventListener('click', e => {
    const on = e.currentTarget.classList.toggle('on');
    /* 静音同时也把语音转文字停下，免得麦克风一直听着 */
    if (on && window.CallVoice && CallVoice.isRunning()) CallVoice.stop();
    Phone.toast(on ? '已静音' : '取消静音');
  });
  $('call-speaker').addEventListener('click', e => {
    e.currentTarget.classList.toggle('on');
    Phone.toast(e.currentTarget.classList.contains('on') ? '已开扬声器' : '已关扬声器');
  });
  $('incoming-accept').addEventListener('click', ()=> Call.answer());
  $('incoming-decline').addEventListener('click', ()=> Call.decline());

  /* ---------- 桌面 dock ---------- */
  document.querySelectorAll('.dock-item').forEach(b => {
    b.onclick = ()=>{ Phone.haptic(12); Apps.open(b.dataset.open); };
  });

  /* ---------- 把 [data-ico="xxx"] 的占位元素填成 SVG 图标 ---------- */
  (function fillIcons(){
    document.querySelectorAll('[data-ico]:empty').forEach(el => {
      const n = el.dataset.ico;
      if (window.Icons && Icons.has(n)) el.innerHTML = Icons.svg(n, 22);
    });
  })();

  /* ---------- 桌面双人卡：点「我」换角色，点「他」去聊天 ---------- */
  document.querySelectorAll('[data-open-char]').forEach(el => {
    el.onclick = () => {
      const which = el.dataset.openChar;
      Phone.haptic(10);
      if (which === 'ta'){ Apps.open('chat'); Chat.open(Phone.S.activeChar); }
      else Apps.open('chars');
    };
  });

  /* ---------- 桌面大时钟：每分钟对齐刷新 ---------- */
  (function hometime(){
    const tick = () => {
      const hs = document.getElementById('homescreen');
      if (hs && hs.classList.contains('active') && Phone.renderHomeCards){
        Phone.renderHomeCards(Phone.cur(), Phone.st(Phone.S.activeChar));
      }
    };
    setInterval(tick, 15000);
  })();

  /* ---------- 首次进入 ---------- */
  if (!localStorage.getItem('xmj.greeted')){
    localStorage.setItem('xmj.greeted', '1');
    setTimeout(()=> Phone.banner('xu', '醒了？醒了就回消息。', 'msg'), 1600);
  }

  /* =========================================================
     主动消息调度：你不在的时候，他也会来找你
     ========================================================= */
  let lastUserAct = Date.now();
  ['click','keydown','touchstart'].forEach(ev =>
    document.addEventListener(ev, ()=>{ lastUserAct = Date.now(); }, {passive:true})
  );
  function idleMinutes(){ return (Date.now() - lastUserAct) / 60000; }

  setInterval(()=>{
    if (!Phone.S.unlocked) return;
    const id = Phone.S.activeChar;
    const s = Phone.st(id);
    const c = Phone.char(id);
    const idle = idleMinutes();
    const hr = new Date().getHours();
    const late = hr >= 23 || hr < 5;

    /* 多久没说话就主动找你。聊得越多，他越黏人 */
    const talks = Phone.talkCount(id);
    const gap = Math.max(25, 90 - Math.min(60, talks)) / 60;   // 分钟
    if (idle > gap && Math.random() < .55){
      lastUserAct = Date.now() - gap * 60000 * .6;
      const m = Engine.proactive(c);
      Chat.push(id, Object.assign({}, m, { from:'ta' }));
      s.unread++;
      Phone.save();
      Phone.banner(id, m.t === 'voice' ? '[语音] ' + m.text : String(m.v||''), 'msg');
      Phone.haptic(18);
      Phone.blurp();
      Phone.renderIfVisible();
      return;
    }

    if (late && Phone.talkCount(id) >= 20 && Math.random() < .18){
      lastUserAct = Date.now();
      const reasons = c.callReasons || ['想你了'];
      Phone.showIncoming(id, reasons[Math.floor(Math.random()*reasons.length)]);
    }
  }, 30000);

  /* 没在聊天时，未读堆到 3 条会追加"查岗" */
  setInterval(()=>{
    if (!Phone.S.unlocked) return;
    const id = Phone.S.activeChar;
    const s = Phone.st(id);
    if (Chat.isOpen() && Chat.cur === id) return;
    if (s.unread >= 3 && Math.random() < .4){
      const m = Engine.proactive(Phone.char(id));
      Chat.push(id, Object.assign({}, m, { from:'ta' }));
      s.unread++; Phone.save();
      Phone.banner(id, m.t === 'voice' ? '[语音] ' + m.text : String(m.v||''), 'msg');
      Phone.renderIfVisible();
    }
  }, 45000);

  /* ---------- 他偶尔会申请看你一眼（摄像头权限） ----------
     低概率，且必须用户不在摄像头会话中、摄像头可用。
     注意：这里只是「申请」，用户不同意就什么都不会发生。 */
  setInterval(()=>{
    if (!Phone.S.unlocked) return;
    if (!window.CamPermission || !window.Camera) return;
    if (!Camera.supported() || !Camera.isSecure()) return;
    if (Camera.isOpen()) return;                 /* 已经在看，不重复申请 */
    if (Math.random() > .12) return;             /* 每次心跳 12% 概率 */
    const id = Phone.S.activeChar;
    const s = Phone.st(id);
    if (Phone.talkCount(id) < 8) return;         /* 还没聊几句，不会提这种要求 */
    /* 已经有一条待处理的申请就不再叠加 */
    if (s.msgs.some(m => m._camRequest)) return;
    CamPermission.ask(id);
    Phone.renderIfVisible();
  }, 120000);

  /* ---------- 低电量提醒 ---------- */
  setInterval(()=>{
    if (Phone.S.battery <= 15 && !Phone.S._lowWarn){
      Phone.S._lowWarn = true;
      Phone.toast(Phone.cur().name + '：你手机快没电了，去充电。');
    }
    if (Phone.S.battery > 25) Phone.S._lowWarn = false;
  }, 20000);

  /* ---------- 启动 ---------- */
  Phone.renderHome();
  if (Phone.S.unlocked) Phone.unlock(); else Phone.lock();

  /* 所有脚本加载完毕后，再补渲染一次（确保 APPS / Icons 都到位） */
  requestAnimationFrame(() => {
    Phone.renderHome();
    document.querySelectorAll('[data-ico]:empty').forEach(el => {
      const n = el.dataset.ico;
      if (window.Icons && Icons.has(n)) el.innerHTML = Icons.svg(n, 26);
    });
  });

  console.log('%c小手机 · 已启动', 'color:#ff5f8d;font-weight:bold',
    Phone.allChars().length + ' 位恋人待命中');
})();
