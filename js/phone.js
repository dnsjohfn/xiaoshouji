/* =========================================================
   小手机 · 手机系统层
   状态、解锁、震动、铃声、通知、拨号、主题
   ========================================================= */

const Phone = (() => {

  const KEY = 'xmj.state.v1';

  const DEFAULT = {
    unlocked: false,
    battery: 86,
    theme: 'rose',
    wallpaper: '',        /* 锁屏壁纸（dataURL） */
    homeWallpaper: '',    /* 桌面壁纸（dataURL）；空则跟随锁屏 */
    activeChar: '',       /* 由用户自建的角色接管（没有预设角色） */
    meName: '我',         /* 我自己显示的名字 */
    meAvatar: '',         /* 我自己的头像（dataURL）；空则用文字 */
    usedAt: Date.now(),
    chars: {},            /* 每个角色的会话状态，按 id 惰性创建 */
    customCards: []
  };

  let S = null;

  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      S = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT));
      S.chars = S.chars || {};
      /* 兼容旧存档里残留的预设角色状态：只保留用户自建卡片对应的记录 */
      S.customCards = S.customCards || [];
      const known = {};
      S.customCards.forEach(c => { if (c && c.id) known[c.id] = 1; });
      Object.keys(S.chars).forEach(k => { if (!known[k]) delete S.chars[k]; });
      /* 若活跃角色已被删除，回退到第一个自建角色（可能为空） */
      if (!S.activeChar || !known[S.activeChar]){
        S.activeChar = (S.customCards[0] && S.customCards[0].id) || '';
      }
      if (typeof S.homeWallpaper !== 'string') S.homeWallpaper = '';
      if (typeof S.meAvatar !== 'string') S.meAvatar = '';
      if (typeof S.meName !== 'string') S.meName = '我';
    }catch(e){
      S = JSON.parse(JSON.stringify(DEFAULT));
    }
    return S;
  }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }
  function reset(){ S = JSON.parse(JSON.stringify(DEFAULT)); save(); }

  /* ---------- 角色访问 ----------
     没有预设角色：所有角色都来自用户自建卡片（customCards）。 */
  function allChars(){
    return (S.customCards || []).slice();
  }
  function char(id){
    const list = allChars();
    return list.find(c => c && c.id === id) || list[0] || null;
  }
  function cur(){ return char(S.activeChar); }
  function st(id){
    id = id || S.activeChar;
    if (!id) return { unread:0, msgs:[], photos:[], diary:[], calls:[], lastSeen:0 };
    return S.chars[id] || (S.chars[id] = { unread:0, msgs:[], photos:[], diary:[], calls:[], lastSeen:0 });
  }

  /* ---------- 亲密度已移除：改为按「聊天轮数」衡量熟悉度 ----------
     主动消息频率、通话时机等只跟 talkCount 有关；
     相册内容完全由用户自己上传，与聊天进度无关。 */
  function talkCount(id){
    const s = st(id);
    return (s.msgs || []).filter(m => m && m.from === 'me').length;
  }
  function unreadTotal(){ return Object.keys(S.chars).reduce((a,k)=> a + (S.chars[k].unread||0), 0); }

  /* ---------- 主题 ---------- */
  function applyTheme(id){
    const t = THEMES.find(x => x.id === id) || THEMES[0];
    S.theme = t.id;
    const r = document.documentElement.style;
    r.setProperty('--bg1', t.bg1);
    r.setProperty('--bg2', t.bg2);
    r.setProperty('--bg3', t.bg3);
    r.setProperty('--accent', t.accent);
    r.setProperty('--accent2', t.accent2);
    save();
    return t;
  }
  function applyWallpaper(dataUrl){
    S.wallpaper = dataUrl || '';
    applyWall(true);
    save();
  }
  /* 桌面壁纸（空则跟随锁屏壁纸） */
  function applyHomeWallpaper(dataUrl){
    S.homeWallpaper = dataUrl || '';
    applyWall(false);
    save();
  }
  /* 把当前的壁纸设置应用到 DOM。lock=true 处理锁屏，false 处理桌面 */
  function applyWall(lock){
    const url = lock ? S.wallpaper : (S.homeWallpaper || S.wallpaper);
    const el = document.getElementById(lock ? 'lockscreen' : 'homescreen');
    if (!el) return;
    if (url){
      el.style.setProperty('--wall-image', `url("${url}")`);
      el.classList.add('wall-image');
    } else {
      el.style.removeProperty('--wall-image');
      el.classList.remove('wall-image');
    }
    /* 兼容旧逻辑：屏幕级 --wall-image（应用页半透明叠加用） */
    if (lock && !S.homeWallpaper){
      const scr = document.getElementById('screen');
      document.documentElement.style.setProperty('--wall-image', S.wallpaper ? `url("${S.wallpaper}")` : 'none');
      if (scr) scr.classList.toggle('wall-image', !!S.wallpaper);
    }
  }

  /* ---------- 头像 ----------
     avatarHTML(cObj, size, extraClass) 统一出头像：
     - 角色卡里有 img（自定义图片头像）→ 渲染 <img>
     - 否则用文字首字 + 渐变色背景
     这样角色头像、聊天头像、锁屏头像一次改全生效。 */
  function avatarHTML(c, opts){
    opts = opts || {};
    const size = opts.size || 40;
    const cls = opts.cls || '';
    const radius = opts.radius || Math.round(size * 0.34);
    const style = [
      `width:${size}px`, `height:${size}px`, `border-radius:${radius}px`,
      `font-size:${Math.round(size * 0.42)}px`
    ].join(';');
    const grad = `linear-gradient(140deg,${c.c1 || 'var(--accent)'},${c.c2 || 'var(--accent2)'})`;
    const img = (c && c.id) ? charImg(c) : (c && c.img) || '';
    if (img){
      return `<span class="avimg ${cls}" style="${style};background-image:url(&quot;${img}&quot;)"></span>`;
    }
    return `<span class="avtxt ${cls}" style="${style};background:${grad}">${escapeHtml((c && c.avatar) || '?')}</span>`;
  }
  /* 我的头像 */
  function meAvatarHTML(opts){
    opts = opts || {};
    const me = { avatar: S.meName || '我', img: S.meAvatar || '', c1:'var(--accent)', c2:'var(--accent2)' };
    return avatarHTML(me, opts);
  }
  function setMeAvatar(dataUrl){ S.meAvatar = dataUrl || ''; save(); }
  function setMeName(n){ S.meName = (n || '我').slice(0,6); save(); }
  /* 给角色设置/清除图片头像。
     自定义角色直接写进卡片；内置角色（CHARS 是共享全局对象，不能直接改）
     存进 S.avatars 覆盖表，这样也能持久化。 */
  function setCharAvatar(charId, dataUrl){
    const c = allChars().find(x => x.id === charId);
    if (!c) return null;
    if (S.customCards && S.customCards.some(x => x.id === charId)){
      c.img = dataUrl || '';
    } else {
      if (!S.avatars) S.avatars = {};
      if (dataUrl) S.avatars[charId] = dataUrl;
      else delete S.avatars[charId];
    }
    save();
    return c;
  }
  /* 取角色的图片头像（内置优先查覆盖表） */
  function charImg(c){
    if (!c) return '';
    if (S.customCards && S.customCards.some(x => x.id === c.id)) return c.img || '';
    return (S.avatars && S.avatars[c.id]) || c.img || '';
  }

  /* ---------- 触感反馈 ---------- */
  /* 默认关闭：点击时的手机震动 + 机身左右摇晃，都会让用户觉得"点一下就震颤"。
     需要时可在控制台执行 Phone.setHaptic(true) 重新打开。 */
  let HAPTIC_ON = false;
  function setHaptic(on){ HAPTIC_ON = !!on; return HAPTIC_ON; }
  function haptic(pattern){
    if (!HAPTIC_ON) return;
    try{ if (navigator.vibrate) navigator.vibrate(pattern || 18); }catch(e){}
    const p = document.getElementById('phone');
    if (p){
      p.animate(
        [{transform:'translateX(0)'},{transform:'translateX(-3px)'},{transform:'translateX(3px)'},{transform:'translateX(0)'}],
        { duration:170, easing:'ease-out' }
      );
    }
  }

  /* ---------- 铃声（Web Audio 合成，不需要任何音频文件） ---------- */
  let AC = null;
  function ac(){
    if (!AC){
      const C = window.AudioContext || window.webkitAudioContext;
      if (C) AC = new C();
    }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, start, dur, type, gainV){
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    g.gain.setValueAtTime(0, c.currentTime + start);
    g.gain.linearRampToValueAtTime(gainV || .12, c.currentTime + start + .02);
    g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + start + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + .03);
  }
  const RINGS = {
    xu:  [784, 988, 784, 659],
    lin: [523, 659, 784, 1047],
    qi:  [880, 1175, 880, 1175]
  };
  function ring(charId, loops){
    const seq = RINGS[charId] || RINGS.xu;
    const n = loops || 1;
    for (let k = 0; k < n; k++){
      seq.forEach((f,i) => {
        tone(f, k*1.1 + i*0.19, .34, 'triangle', .1);
        tone(f/2, k*1.1 + i*0.19, .3, 'sine', .05);
      });
    }
  }
  function blurp(){ tone(1180, 0, .07, 'sine', .07); tone(1560, .05, .09, 'sine', .05); }
  function sendSfx(){ tone(660, 0, .07, 'sine', .05); tone(990, .06, .1, 'sine', .04); }

  /* ---------- 状态栏 / 时钟 ---------- */
  function pad(n){ return String(n).padStart(2,'0'); }
  function clockText(){
    const d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function dateText(){
    const d = new Date();
    const w = ['日','一','二','三','四','五','六'][d.getDay()];
    return `${d.getMonth()+1}月${d.getDate()}日 星期${w}`;
  }
  function renderStatus(){
    const bt = document.getElementById('sb-battery-text');
    if (!bt) return;
    bt.textContent = Math.round(S.battery) + '%';
    const fill = document.getElementById('sb-battery-fill');
    fill.style.width = Math.max(2, S.battery) + '%';
    const box = fill.parentElement;
    box.classList.toggle('low', S.battery <= 20);
    box.classList.toggle('mid', S.battery > 20 && S.battery <= 45);
    const lt = document.getElementById('ls-time');
    if (lt){ lt.textContent = clockText(); document.getElementById('ls-date').textContent = dateText(); }
  }
  function drainBattery(hours){
    S.battery = Math.max(3, S.battery - hours * 1.2);
    save(); renderStatus();
  }
  function chargeBattery(n){
    if (!n) return;
    S.battery = Math.min(100, S.battery + n);
    save(); renderStatus();
  }

  /* ---------- 通知（iOS 风格横幅） ---------- */
  let bannerTimer = null;
  function banner(charId, text, type){
    const c = char(charId);
    const b = document.getElementById('banner');

    /* 顶部 App 信息行：小手机图标 + 名称 + "现在" */
    const ai = document.getElementById('bn-app-ico');
    if (ai) ai.innerHTML = (window.Icons ? Icons.svg(type === 'call' ? 'call' : 'chat', 12) : '');
    const bt = document.getElementById('bn-time');
    if (bt){
      const d = new Date();
      bt.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    /* 头像：有图片头像就显示图片 */
    const av = document.getElementById('banner-av');
    if (av){
      const img = charImg(c);
      if (img){
        av.className = 'bn-av avimg';
        av.style.backgroundImage = `url("${img}")`;
        av.textContent = '';
      } else {
        av.className = 'bn-av avtxt';
        av.style.backgroundImage = '';
        av.style.background = `linear-gradient(140deg,${c.c1},${c.c2})`;
        av.textContent = c.avatar;
      }
    }

    document.getElementById('banner-title').textContent = c.name;
    document.getElementById('banner-msg').textContent = text || '';
    b.hidden = false;
    b.dataset.char = charId;
    b.classList.remove('show', 'out');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(()=>{ dismissBanner(); }, 5200);

    /* 锁屏只留「人物卡」一条，不再重复填充通用通知卡 */
    const card = document.getElementById('ls-notif-card');
    if (card) card.hidden = true;

    const per = document.getElementById('ls-person');
    const lav = document.getElementById('ls-avatar');
    if (lav){
      const limg = charImg(c);
      if (limg){
        lav.className = 'ls-avatar avimg';
        lav.style.backgroundImage = `url("${limg}")`;
        lav.textContent = '';
      } else {
        lav.className = 'ls-avatar avtxt';
        lav.style.backgroundImage = '';
        lav.style.background = `linear-gradient(140deg,${c.c1},${c.c2})`;
        lav.textContent = c.avatar;
      }
    }
    document.getElementById('ls-msg').textContent = text || '';
    per.hidden = false;
  }
  /* 收起横幅（带 iOS 那种上滑回弹动画） */
  function dismissBanner(){
    const b = document.getElementById('banner');
    if (!b || b.hidden) return;
    clearTimeout(bannerTimer);
    b.classList.remove('show');
    b.classList.add('out');
    setTimeout(()=>{ b.hidden = true; b.classList.remove('out'); }, 300);
  }
  function toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._tm);
    t._tm = setTimeout(()=>{ t.hidden = true; }, 1700);
  }
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  }

  /* ---------- 来电 ---------- */
  let incomingTimer = null;
  function showIncoming(charId, reason){
    const c = char(charId);
    const el = document.getElementById('incoming');
    const av = document.getElementById('incoming-avatar');
    const img = charImg(c);
    if (img){
      av.className = 'incoming-avatar avimg';
      av.style.backgroundImage = `url("${img}")`;
      av.textContent = '';
    } else {
      av.className = 'incoming-avatar avtxt';
      av.style.backgroundImage = '';
      av.style.background = `linear-gradient(140deg,${c.c1},${c.c2})`;
      av.textContent = c.avatar;
    }
    document.getElementById('incoming-name').textContent = c.name;
    el.querySelector('.incoming-label').textContent = '来电 · ' + (reason || '小手机');
    el.hidden = false;
    el.dataset.char = charId;
    haptic([30,80,30,80,30]);
    ring(charId, 2);
    clearTimeout(incomingTimer);
    incomingTimer = setTimeout(()=>{
      el.hidden = true;
      const s = st(charId);
      s.calls.unshift({ dir:'missed', dur:0, at:Date.now(), reason });
      s.unread++; save();
      banner(charId, '（未接来电）', 'call');
      renderIfVisible();
    }, 26000);
  }
  function hideIncoming(){
    clearTimeout(incomingTimer);
    document.getElementById('incoming').hidden = true;
  }

  /* ---------- 页面切换 ---------- */
  function lock(){
    S.unlocked = false; save();
    document.getElementById('lockscreen').classList.add('active');
    document.getElementById('homescreen').classList.remove('active');
    document.getElementById('screen').classList.remove('is-home');
  }
  function unlock(){
    S.unlocked = true; save();
    document.getElementById('lockscreen').classList.remove('active');
    document.getElementById('homescreen').classList.add('active');
    document.getElementById('screen').classList.add('is-home');
    document.getElementById('ls-person').hidden = true;
    document.getElementById('ls-notif-card').hidden = true;
    renderHome();
    haptic(12);
  }
  /* 打开应用时收起桌面；回桌面时恢复 */
  function hideHomeFor(){
    const hs = document.getElementById('homescreen');
    if (hs) hs.classList.remove('active');
  }
  function showHome(){
    const hs = document.getElementById('homescreen');
    if (hs) hs.classList.add('active');
    document.getElementById('screen').classList.add('is-home');
  }

  function goHome(){
    Apps.close();
    if (!S.unlocked) return unlock();
    document.getElementById('homescreen').classList.add('active');
    document.getElementById('screen').classList.add('is-home');
    renderHome();
  }

  /* 点 home 条：在应用里→回桌面；已在桌面→锁屏（真机行为） */
  function homeKey(){
    const appview = document.getElementById('appview');
    const inApp = appview && appview.classList.contains('active');
    const hs = document.getElementById('homescreen');
    const onHome = hs && hs.classList.contains('active');
    if (inApp || !onHome) return goHome();
    lock();
    haptic(10);
  }

  /* ---------- 桌面：天气 + 大时钟 ---------- */
  /* 兜底假数据：断网 / 接口挂了 / 用户没授权定位时用，保证桌面不开天窗。
     真实数据由 Weather 模块（Open-Meteo，免 key）提供。 */
  const WEATHERS = [
    { t:'晴',   ico:'sun',   min:24, max:32, air:'空气优 27', city:'崂山区' },
    { t:'阴',   ico:'cloud', min:15, max:27, air:'空气优 27', city:'崂山区' },
    { t:'多云', ico:'cloud', min:19, max:27, air:'空气良 42', city:'崂山区' },
    { t:'小雨', ico:'wave',  min:16, max:22, air:'空气优 18', city:'崂山区' },
    { t:'夜',   ico:'moon',  min:14, max:20, air:'空气优 21', city:'崂山区' }
  ];
  function fallbackWeather(){
    /* 同一天固定一个天气，不刷新就变 —— 只在拿不到真实数据时用 */
    const d = new Date();
    const seed = d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate();
    return WEATHERS[seed % WEATHERS.length];
  }
  /* 取要显示的天气：真实数据优先，没有就兜底假数据 */
  function currentWeather(){
    const W = window.Weather;
    const real = W && W.cached && W.cached();
    if (real && real.t){
      return {
        t: real.t, ico: real.ico,
        min: real.min, max: real.max,
        air: real.air || '',
        city: real.city || '当前位置'
      };
    }
    return fallbackWeather();
  }
  /* 主动去拉一次真实天气（异步，拿到后刷新桌面） */
  let weatherBusy = false;
  function refreshWeather(force){
    const W = window.Weather;
    if (!W || weatherBusy) return Promise.resolve(null);
    weatherBusy = true;
    return W.refresh(force)
      .then(d => { renderHomeCards(cur(), st(S.activeChar)); return d; })
      .catch(e => {
        /* 拿不到真实天气就静默用兜底数据，别打扰用户 */
        return null;
      })
      .finally(() => { weatherBusy = false; });
  }
  function renderHomeCards(c, s){
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const setHtml = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML = v; };

    /* 大时钟 + 日期 */
    const d = new Date();
    const wk = ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    setTxt('hc-date', `${d.getMonth() + 1}月${d.getDate()}日 ${wk} ·`);
    setTxt('hc-time', `${d.getHours()}:${pad(d.getMinutes())}`);

    /* 天气卡（真实数据优先，拿不到用兜底） */
    const w2 = currentWeather();
    setTxt('hw-city', w2.city);
    setTxt('hw-txt', w2.t);
    setTxt('hw-temp', w2.max + '°');
    setTxt('hw-range', `最高${w2.max}° 最低${w2.min}°`);
    setTxt('hw-air', w2.air || '—');
    setHtml('hw-ico', (window.Icons ? Icons.svg(w2.ico, 28) : ''));
    /* 真实数据时给个"实时"小标；兜底数据不标，避免误导 */
    const card = document.getElementById('hs-weather');
    if (card){
      const isReal = !!(window.Weather && Weather.cached && Weather.cached() && Weather.cached().t);
      card.classList.toggle('is-live', isReal);
    }

    /* 锁屏时间也一起刷 */
    const lt = document.getElementById('ls-time');
    if (lt) lt.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const ld = document.getElementById('ls-date');
    if (ld) ld.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${wk}`;
  }

  /* ---------- 桌面渲染 ---------- */
  function renderHome(){
    const c = cur();
    const s = c ? st(c.id) : { msgs: [], unread: 0 };
    const hr = new Date().getHours();
    const greet = hr < 5 ? '还没睡？' : hr < 11 ? '早上好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : hr < 23 ? '晚上好' : '夜里的第几个消息';
    const greetEl = document.getElementById('hs-greet');
    if (greetEl) greetEl.textContent = greet;

    /* 还没有角色：桌面卡片显示引导语，不假装有人在线 */
    const nameEl = document.getElementById('hs-name');
    const love = document.getElementById('ls-love');
    const sub = document.getElementById('hs-sub');
    if (!c){
      if (nameEl) nameEl.textContent = '还没有人住进来';
      if (love) love.textContent = '去【制作人】建一个人设吧';
      if (sub) sub.innerHTML = '建好之后，他就能跟你聊天了';
      renderHomeCards(null, null);
    } else {
      const talks = talkCount(c.id);
      if (love) love.innerHTML = talks > 0 ? `已经聊了 <b>${talks}</b> 句` : `${c.name} 在等你开口`;
      const unread = s.unread || 0;
      if (sub) sub.innerHTML = unread > 0
        ? `他给你发了 <b>${unread}</b> 条消息`
        : `${c.name} 在线，随时可以找他`;
      renderHomeCards(c, s);
    }

    const grid = document.getElementById('hs-grid');
    if (!grid) return;
    const list = (typeof APPS !== 'undefined' && APPS) || (window.APPS) || [];
    if (!list.length) return;   /* 应用表还没加载好，等下次渲染 */
    grid.innerHTML = '';
    list.forEach((a, i) => {
      const d = document.createElement('button');
      d.className = 'app-ico tone-' + ((i % 6) + 1);
      d.style.animationDelay = (i * 22) + 'ms';
      const n = a.badge ? a.badge() : '';
      const ic = (window.Icons && Icons.svg(a.ico, 26)) || '';
      d.innerHTML = `<span class="sq">${ic}${n ? `<span class="badge">${n}</span>` : ''}</span><span class="nm">${a.name}</span>`;
      d.onclick = () => { haptic(12); Apps.open(a.id); };
      grid.appendChild(d);
    });
  }

  function renderIfVisible(){
    const hs = document.getElementById('homescreen');
    if (hs && hs.classList.contains('active')) renderHome();
    if (window.Chat && Chat.isOpen()) Chat.renderHead();
  }

  function init(){
    load();
    applyTheme(S.theme);
    applyWall(true);
    applyWall(false);
    renderStatus();
    setInterval(()=>{ renderStatus(); drainBattery(1/60); }, 60000);
    /* 天气：启动时拉一次，之后每 20 分钟刷新一次（模块内部还有 30 分钟缓存） */
    setTimeout(()=> refreshWeather(false), 600);
    setInterval(()=> refreshWeather(true), 20 * 60 * 1000);
  }

  return {
    init, save, load, reset, get S(){ return S; },
    allChars, char, cur, st, talkCount, unreadTotal,
    applyTheme, applyWallpaper, applyHomeWallpaper, applyWall, haptic, setHaptic, ring, blurp, sendSfx,
    avatarHTML, meAvatarHTML, setMeAvatar, setMeName, setCharAvatar, charImg,
    currentWeather, refreshWeather,
    renderStatus, drainBattery, chargeBattery, clockText, dateText, pad,
    banner, toast, dismissBanner, escapeHtml, showIncoming, hideIncoming,
    lock, unlock, goHome, homeKey, renderHome, renderIfVisible, hideHomeFor, showHome,
    renderHomeCards
  };
})();
