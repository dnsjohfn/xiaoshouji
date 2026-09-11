/* =========================================================
   小手机 · 消息（聊天）App
   ========================================================= */

const Chat = (() => {

  let opener = null;
  let busy = false;
  let lastAt = 0;

  const QUICKS = ['在吗？', '我想你了', '今天好累', '睡不着…', '你在干嘛', '吃饭了吗', '我生气了', '（不回）'];

  function isOpen(){ return !!opener && document.getElementById('appview').classList.contains('active'); }

  /* ---------------- 会话列表 ---------------- */
  function renderList(){
    const body = document.getElementById('app-body');
    let html = '<div style="padding:14px">';
    Phone.allChars().forEach(c => {
      const s = Phone.st(c.id);
      const last = s.msgs[s.msgs.length-1];
      const lastTxt = last
        ? (last.t === 'voice' ? '[语音] ' + (last.text||'') : String(last.v||'').split('\n')[0])
        : '还没有聊过，去打个招呼吧';
      const unread = s.unread ? `<span class="convo-badge">${s.unread}</span>` : '';
      html += `
        <div class="convo-item" data-id="${c.id}" style="margin-bottom:10px;--c1:${c.c1};--c2:${c.c2}">
          ${Phone.avatarHTML(c, { size:50, cls:'convo-av', radius:17 })}
          <div class="convo-mid">
            <div class="convo-name">${Phone.escapeHtml(c.name)}<span class="convo-tag">${Phone.escapeHtml(c.tag||'自定义')}</span></div>
            <div class="convo-last">${Phone.escapeHtml(lastTxt).slice(0,40)}</div>
          </div>
          <div class="convo-right">
            <span class="convo-time">${last ? fmtTime(last.at) : ''}</span>${unread}
          </div>
        </div>`;
    });
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('.convo-item').forEach(el => {
      el.onclick = () => { Phone.S.activeChar = el.dataset.id; Phone.save(); open(el.dataset.id); };
    });
  }

  /* ---------------- 打开聊天 ---------------- */
  function open(id){
    opener = id;
    Phone.S.activeChar = id;
    /* 手机端：只有真正进入「聊天对话」才隐藏系统状态栏，
       会话列表页仍要显示（否则返回键会顶到状态栏位置） */
    document.body.classList.add('in-chatroom');
    const c = Phone.char(id);
    const s = Phone.st(id);
    s.unread = 0;
    s.lastSeen = Date.now();
    Phone.save();

    if (!s.msgs.length){
      let base = 320;
      (c.greeting || []).forEach((g) => {
        base += 600 + Math.random()*520;
        setTimeout(()=>{
          Chat.push(id, Object.assign({}, g, { from:'ta', at:Date.now() }));
          Phone.blurp();
        }, base);
      });
    }

    document.getElementById('app-title').textContent = c.name;
    const I = window.Icons;
    document.getElementById('app-right').innerHTML =
      `<button class="mini-btn" id="ch-cam" title="摄像头">${I.svg('camera', 19)}</button>` +
      `<button class="mini-btn" id="ch-bg" title="聊天背景">${I.svg('palette', 19)}</button>` +
      `<button class="mini-btn" id="ch-call" title="打电话">${I.svg('call', 19)}<span>通话</span></button>`;
    document.getElementById('app-right').querySelector('#ch-call').onclick = () => Call.start(id);
    document.getElementById('app-right').querySelector('#ch-bg').onclick = () => pickChatBg(id);
    document.getElementById('app-right').querySelector('#ch-cam').onclick = () => requestCam(id);

    const body = document.getElementById('app-body');
    const bgStyle = chatBgStyle(id);
    body.innerHTML = `
      <div class="chat-wrap qq" style="--c1:${c.c1};--c2:${c.c2};${bgStyle}">
        <div class="chat-head qq-head">
          <button class="qq-back" id="qq-back" aria-label="返回">${I.svg('back', 22)}</button>
          ${Phone.avatarHTML(c, { size:34, cls:'mini-av', radius:12 })}
          <div>
            <div class="who">${Phone.escapeHtml(c.name)}</div>
            <div class="state"><i class="dot"></i><span id="ch-state">在线</span></div>
          </div>
        </div>
        <div class="chat-list qq-list" id="chat-list"></div>
        <div class="qq-typing" id="qq-typing" hidden>
          <span class="tt"><i></i><i></i><i></i></span><span id="qq-typing-txt">对方正在输入…</span>
        </div>
        <div class="quick" id="chat-quick">
          ${QUICKS.map(q => `<button data-q="${Phone.escapeHtml(q)}">${q}</button>`).join('')}
        </div>
        <div class="composer">
          <button class="icon-btn rec" id="btn-rec" title="按住说话">${I.svg('mic', 21)}</button>
          <textarea id="chat-input" rows="1" placeholder="说点什么…"></textarea>
          <button class="sendbtn" id="chat-send">发送</button>
        </div>
      </div>`;

    renderAll();
    bind();
    /* QQ 头部自带返回键（手机端隐藏了系统 .appbar） */
    const qb = document.getElementById('qq-back');
    if (qb) qb.onclick = () => { Phone.goHome(); };
    document.getElementById('appview').classList.add('active');
    document.body.classList.add('in-app');   /* 让系统状态栏让位给应用标题栏 */
    setTimeout(()=>{ const l = document.getElementById('chat-list'); if (l) l.scrollTop = l.scrollHeight; }, 60);
  }

  function renderAll(){
    const list = document.getElementById('chat-list');
    if (!list) return;
    const s = Phone.st(opener);
    list.innerHTML = '';
    lastAt = 0;
    s.msgs.forEach((m, i) => list.appendChild(bubble(opener, m, i)));
    scroll();
    renderHead();
  }

  function renderHead(){
    const s = Phone.st(opener);
    Phone.renderHome();
  }

  function bubble(id, m, idx){
    const c = Phone.char(id);
    const row = document.createElement('div');
    const mine = m.from === 'me';
    row.className = 'bg-row qq-row' + (mine ? ' me' : '');

    /* 时间分组：间隔 > 5 分钟插一条时间 */
    if (idx === 0 || (m.at && lastAt && m.at - lastAt > 5 * 60 * 1000)){
      const tm = document.createElement('div');
      tm.className = 'qq-time';
      tm.textContent = fullTime(m.at);
      row.appendChild(tm);
    }
    lastAt = m.at;

    if (!mine && m.t === 'voice'){
      const sec = m.sec || 4;
      const w = Array.from({length: 16}, (_, i) => {
        const h = 5 + Math.round(Math.abs(Math.sin((i + String(m.text||'').length) * 1.7)) * 14);
        return `<i style="height:${h}px"></i>`;
      }).join('');
      const el = document.createElement('div');
      el.className = 'voice';
      el.innerHTML = `<span class="vplay">▶</span><span class="wave">${w}</span><span class="vsec">${sec}"</span>`;
      el.onclick = () => playVoice(el, m);
      row.innerHTML = Phone.avatarHTML(c, { size:36, cls:'av', radius:12 });
      row.appendChild(el);
      return row;
    }

    const b = document.createElement('div');
    b.className = 'bubble qq-bubble';

    /* ---- 摄像头权限请求：带「允许 / 拒绝」按钮 ---- */
    if (m._camRequest && !mine){
      b.classList.add('cam-req');
      b.innerHTML =
        `<div class="camreq-hd">${window.Icons.svg('camera', 18)}<span>请求使用摄像头</span></div>` +
        `<div class="camreq-txt">${Phone.escapeHtml(m.v || '')}</div>` +
        `<div class="camreq-acts">` +
          `<button class="camreq-ok">允许一次</button>` +
          `<button class="camreq-no">拒绝</button>` +
        `</div>` +
        `<div class="camreq-tip">每次都要你点同意，不会自动开启</div>`;
      row.innerHTML = Phone.avatarHTML(c, { size:36, cls:'av', radius:12 });
      row.appendChild(b);
      b.querySelector('.camreq-ok').onclick = () => {
        CamPermission.grant(id, m._camRequest);
      };
      b.querySelector('.camreq-no').onclick = () => {
        CamPermission.deny(id, m._camRequest);
      };
      return row;
    }

    if (m._action){
      b.classList.add('action');
      const parts = String(m.v||'').split('\n');
      b.innerHTML = Phone.escapeHtml(parts[0]) + (parts[1] ? '<br>' + Phone.escapeHtml(parts[1]) : '');
    } else {
      b.innerHTML = Phone.escapeHtml(m.v || '').replace(/\n/g,'<br>');
    }

    /* ---- 摄像头拍下的画面：图片气泡 ---- */
    if (m._camShot){
      b.classList.add('cam-shot');
      b.innerHTML = `<img class="cam-img" src="${m._camShot}" alt="摄像头画面">` +
        `<span class="cam-cap">${Phone.escapeHtml(m.v || '')}</span>`;
    }
    if (m.t === 'text' && !m._action && !m._camShot){
      b.innerHTML += `<span class="meta">${fmtTime(m.at)}${mine ? ' <i class="read">已读</i>' : ''}</span>`;
    }
    row.innerHTML = mine
      ? Phone.meAvatarHTML({ size:36, cls:'av me-av', radius:12 })
      : Phone.avatarHTML(c, { size:36, cls:'av', radius:12 });
    row.appendChild(b);
    return row;
  }

  function fullTime(ts){
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hm = Phone.pad(d.getHours()) + ':' + Phone.pad(d.getMinutes());
    if (sameDay) return hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  /* ---------------- 摄像头（由用户主动发起） ----------------
     点聊天右上角相机 → 他"申请"一次 → 你在气泡里点允许
     → 系统权限 → 画面。和 AI 主动申请走同一条路。 */
  function requestCam(id){
    id = id || opener;
    if (!id) return;
    if (!Camera.supported()){
      Phone.toast('这个浏览器不支持摄像头');
      return;
    }
    if (!Camera.isSecure()){
      Phone.toast('摄像头需要 https 或 localhost');
      return;
    }
    if (Camera.isOpen()){
      /* 已经开着 → 直接聚焦预览 */
      Phone.toast('摄像头已经开着');
      return;
    }
    CamPermission.ask(id, '摄像头给你开着，让我看看你？');
  }

  /* ---------------- 聊天背景 ---------------- */
  const CHAT_BG_KEY = 'xmj.chatbg.v1';

  function loadChatBgs(){
    try { return JSON.parse(localStorage.getItem(CHAT_BG_KEY) || '{}'); } catch (e) { return {}; }
  }
  function chatBgStyle(id){
    const map = loadChatBgs();
    const v = map[id] || map.__default;
    if (!v) return '';
    if (v.type === 'image') return `--chat-bg-image:url("${v.value}");`;
    return `--chat-bg:${v.value};--chat-bg-image:none;`;
  }
  function saveChatBg(id, v){
    const map = loadChatBgs();
    if (id) map[id] = v; else map.__default = v;
    try { localStorage.setItem(CHAT_BG_KEY, JSON.stringify(map)); } catch (e) {}
  }

  /* 背景预设：多层渐变 + 柔光，比原来的两色线性更有质感 */
  const BG_PRESETS = [
    { name: '默认', ico: 'palette',
      v: { type:'solid', value:'radial-gradient(120% 70% at 50% 0%,#ffffff 0%,#f1f4f9 55%,#e6ebf3 100%)' } },
    { name: '天空', ico: 'cloud',
      v: { type:'solid', value:'radial-gradient(110% 65% at 50% 0%,#ffffff 0%,#dbeeff 42%,#a9d3ff 100%)' } },
    { name: '暮色', ico: 'sun',
      v: { type:'solid', value:'linear-gradient(168deg,#2b2144 0%,#5c3a68 38%,#a85f74 66%,#e79b78 100%)' } },
    { name: '抹茶', ico: 'flower',
      v: { type:'solid', value:'radial-gradient(115% 70% at 50% 0%,#fbfffa 0%,#e2f5e2 48%,#cceccc 100%)' } },
    { name: '夜谈', ico: 'moon',
      v: { type:'solid', value:'radial-gradient(120% 75% at 50% 0%,#1e2740 0%,#131a2b 55%,#0a0e18 100%)' } },
    { name: '樱花', ico: 'flower',
      v: { type:'solid', value:'radial-gradient(120% 70% at 50% 0%,#fff6f9 0%,#ffe0ea 45%,#ffc7dc 100%)' } },
    { name: '纸质', ico: 'doc',
      v: { type:'solid', value:'linear-gradient(175deg,#fdfaf3 0%,#f7f1e5 55%,#efe6d6 100%)' } },
    { name: '深海', ico: 'wave',
      v: { type:'solid', value:'linear-gradient(170deg,#021d2e 0%,#0a4a63 45%,#166f86 72%,#39b6a8 100%)' } },
    { name: '城市', ico: 'city',
      v: { type:'solid', value:'linear-gradient(170deg,#161b2c 0%,#26304d 45%,#4a5a86 78%,#8fa3c8 100%)' } }
  ];

  function pickChatBg(id){
    const map = loadChatBgs();
    const cur = map[id] || map.__default;
    const curName = cur ? (cur.name || '自定义') : '默认';

    let ov = document.getElementById('bgPanel');
    if (!ov){
      ov = document.createElement('div');
      ov.id = 'bgPanel';
      ov.className = 'bgpanel-overlay';
      ov.innerHTML = '<div class="bgpanel"><div class="bgpanel-body" id="bgPanelBody"></div></div>';
      document.getElementById('screen').appendChild(ov);
      ov.addEventListener('click', e => {
        if (e.target === ov) closeBgPanel();
      });
    }

    const body = document.getElementById('bgPanelBody');
    body.innerHTML =
      '<div class="bgpick">' +
        '<div class="bgpick-hd"><b>聊天背景</b>' +
          '<button class="bgpanel-x" id="bgClose" aria-label="关闭">' + window.Icons.svg('close', 18) + '</button></div>' +
        '<div class="bgpick-cur">当前：<b>' + Phone.escapeHtml(curName) + '</b></div>' +
        '<div class="bgpick-grid">' +
          BG_PRESETS.map(function(p, k){
            return '<button class="bgchip" data-bg="' + k + '" style="background:' + p.v.value + '" title="' + p.name + '">' +
                   '<i class="bgchip-ico">' + window.Icons.svg(p.ico || 'palette', 16) + '</i>' +
                   '<span>' + p.name + '</span></button>';
          }).join('') +
        '</div>' +
        '<div class="bgpick-actions">' +
          '<button class="btn" id="bgUpload">' + window.Icons.svg('folder', 18) + '<span>从本机选一张图</span></button>' +
          '<button class="btn" id="bgAll">' + window.Icons.svg('check', 18) + '<span>应用到全部角色</span></button>' +
          '<button class="btn danger" id="bgReset">' + window.Icons.svg('trash', 18) + '<span>恢复默认</span></button>' +
        '</div>' +
        '<div class="hint">背景只存在本机，不会上传。</div>' +
      '</div>';

    document.getElementById('bgClose').onclick = closeBgPanel;

    /* 预设色块 */
    body.querySelectorAll('.bgchip').forEach(function(chip){
      chip.onclick = function(){
        const p = BG_PRESETS[+chip.dataset.bg];
        saveChatBg(opener, { type: 'solid', value: p.v.value, name: p.name });
        applyBgLive(opener);
        Phone.toast('背景已切换：' + p.name);
        const curEl = body.querySelector('.bgpick-cur b');
        if (curEl) curEl.textContent = p.name;
      };
    });

    /* 上传图片 */
    document.getElementById('bgUpload').onclick = function(){
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = function(){
        const file = inp.files && inp.files[0];
        if (!file) return;
        const r = new FileReader();
        r.onload = function(){
          saveChatBg(opener, { type: 'image', value: r.result, name: '自定义图片' });
          applyBgLive(opener);
          Phone.toast('背景已设为你的图片');
          const curEl = body.querySelector('.bgpick-cur b');
          if (curEl) curEl.textContent = '自定义图片';
        };
        r.readAsDataURL(file);
      };
      inp.click();
    };

    /* 应用到全部 */
    document.getElementById('bgAll').onclick = function(){
      const m = loadChatBgs();
      const c = m[opener] || m.__default;
      if (!c){ Phone.toast('先选一个背景'); return; }
      m.__default = c;
      try { localStorage.setItem(CHAT_BG_KEY, JSON.stringify(m)); } catch (e) {}
      Phone.toast('已应用到全部角色');
    };

    /* 恢复默认 */
    document.getElementById('bgReset').onclick = function(){
      const m = loadChatBgs();
      delete m[opener];
      try { localStorage.setItem(CHAT_BG_KEY, JSON.stringify(m)); } catch (e) {}
      applyBgLive(opener);
      Phone.toast('已恢复默认背景');
      const curEl = body.querySelector('.bgpick-cur b');
      if (curEl) curEl.textContent = '默认';
    };

    ov.classList.add('show');
  }

  function closeBgPanel(){
    const ov = document.getElementById('bgPanel');
    if (ov) ov.classList.remove('show');
  }

  function applyBgLive(id){
    const el = document.querySelector('.chat-wrap');
    if (!el) return;
    const style = chatBgStyle(id);
    el.setAttribute('style', `--c1:${Phone.char(id).c1};--c2:${Phone.char(id).c2};${style}`);
  }

  function playVoice(el, m){
    if (el.classList.contains('playing')) return;
    el.classList.add('playing');
    el.querySelector('.vplay').textContent = '❚❚';
    Phone.blurp();
    let left = m.sec || 4;
    const sec = el.querySelector('.vsec');
    if (m.text){
      let t = el.querySelector('.vtext');
      if (!t){ t = document.createElement('div'); t.className = 'vtext'; el.appendChild(t); }
      t.textContent = m.text;
      t.style.display = 'block';
      el.style.flexWrap = 'wrap';
    }
    const tm = setInterval(()=>{
      left--; sec.textContent = left + '"';
      if (left <= 0){
        clearInterval(tm);
        el.classList.remove('playing');
        el.querySelector('.vplay').textContent = '▶';
        sec.textContent = (m.sec||4) + '"';
      }
    }, 1000);
  }

  function scroll(){
    const l = document.getElementById('chat-list');
    if (l) l.scrollTop = l.scrollHeight;
  }

  function fmtTime(ts){
    if (!ts) return '';
    const d = new Date(ts);
    return Phone.pad(d.getHours()) + ':' + Phone.pad(d.getMinutes());
  }

  /* ---------------- 写入消息 ---------------- */
  function push(id, msg){
    const s = Phone.st(id);
    msg.at = msg.at || Date.now();
    s.msgs.push(msg);
    /* 只保留最近的若干条（Engine.limits.MSG_MAX，默认 800）；更早的已进滚动摘要 */
    const cap = (Engine.limits && Engine.limits.MSG_MAX) || 800;
    if (s.msgs.length > cap) s.msgs.splice(0, s.msgs.length - cap);
    Phone.save();
    if (opener === id && document.getElementById('chat-list')){
      const list = document.getElementById('chat-list');
      const el = bubble(id, msg, s.msgs.length - 1);
      const tp = document.getElementById('typing-row');
      if (tp && msg.from === 'ta') list.insertBefore(el, tp);
      else list.appendChild(el);
      scroll();
    }
  }

  function typing(on){
    const list = document.getElementById('chat-list');
    if (!list) return;
    let el = document.getElementById('typing-row');
    if (on){
      if (el) return;
      const c = Phone.char(opener);
      el = document.createElement('div');
      el.className = 'typing';
      el.id = 'typing-row';
      el.style.setProperty('--c1', c.c1);
      el.style.setProperty('--c2', c.c2);
      el.innerHTML = Phone.avatarHTML(c, { size:36, cls:'av', radius:12 }) + '<div class="typing-bub"><i></i><i></i><i></i></div>';
      list.appendChild(el);
      scroll();
    } else if (el){ el.remove(); }
  }

  /* ---------------- 发送 ---------------- */
  async function send(text){
    text = (text || '').trim();
    if (!text || busy || !opener) return;
    const id = opener;
    busy = true;
    Phone.sendSfx();
    push(id, { t:'text', v:text, from:'me' });

    typing(true);
    const wait = 420 + Math.min(1600, text.length * 55) + Math.random()*600;

    let rep;
    try{
      rep = await Engine.reply(Phone.char(id), Phone.st(id).msgs.slice(0,-1), text);
      if (rep._err) console.warn('在线模型失败，已回退本地引擎：', rep._err);
    }catch(e){
      rep = { t:'text', v:'（信号不太好……你再说一遍？）' };
    }

    setTimeout(()=>{
      typing(false);
      push(id, Object.assign({}, rep, { from:'ta' }));
      Phone.banner(id, rep.t === 'voice' ? '[语音] ' + rep.text : String(rep.v||''), 'msg');
      Phone.haptic(14);
      if (rep.t !== 'voice') Phone.blurp();
      renderHead();
      busy = false;

      if (Math.random() < .3){
        setTimeout(()=>{
          const extra = Engine.proactive(Phone.char(id));
          typing(true);
          setTimeout(()=>{
            typing(false);
            push(id, Object.assign({}, extra, { from:'ta' }));
            scroll();
          }, 700 + Math.random()*500);
        }, 900 + Math.random()*600);
      }
    }, wait);

    const fact = Engine.remember(id, text);
    if (fact) setTimeout(()=>Phone.toast('他记住了：' + fact), 1200);
  }

  /* ---------------- 事件 ---------------- */
  function bind(){
    const input = document.getElementById('chat-input');
    input.addEventListener('input', ()=>{
      input.style.height = 'auto';
      input.style.height = Math.min(96, input.scrollHeight) + 'px';
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        send(input.value);
        input.value = ''; input.style.height = '38px';
      }
    });
    document.getElementById('chat-send').onclick = ()=>{
      send(input.value);
      input.value = ''; input.style.height = '38px';
    };
    document.getElementById('chat-quick').querySelectorAll('button').forEach(b=>{
      b.onclick = ()=> send(b.dataset.q);
    });

    // 按住说话（浏览器语音识别；不支持则给出提示）
    const rec = document.getElementById('btn-rec');
    let recog = null, recording = false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const startRec = ()=>{
      recording = true;
      rec.classList.add('recording');
      Phone.haptic([12, 40, 12]);
      if (SR){
        try{
          recog = new SR();
          recog.lang = 'zh-CN';
          recog.interimResults = true;
          recog.onresult = ev => {
            const t = Array.from(ev.results).map(r=>r[0].transcript).join('');
            input.value = t;
          };
          recog.start();
          Phone.toast('松开就发送…');
        }catch(e){ recog = null; Phone.toast('语音识别启动失败，先打字吧~'); }
      } else {
        Phone.toast('这台设备不支持语音识别，先打字吧~');
      }
    };
    const endRec = ()=>{
      if (!recording) return;
      recording = false;
      rec.classList.remove('recording');
      if (recog){ try{ recog.stop(); }catch(e){} }
      const v = input.value.trim();
      if (SR && v){ send(v); input.value=''; }
    };
    rec.addEventListener('mousedown', startRec);
    rec.addEventListener('mouseup', endRec);
    rec.addEventListener('mouseleave', endRec);
    rec.addEventListener('touchstart', e=>{ e.preventDefault(); startRec(); }, {passive:false});
    rec.addEventListener('touchend', e=>{ e.preventDefault(); endRec(); }, {passive:false});
  }

  function close(){ opener = null; document.body.classList.remove('in-chatroom'); }

  return { open, close, isOpen, renderList, renderAll, renderHead, push, send, typing, fmtTime,
    requestCam, pickChatBg,
    get cur(){ return opener; } };
})();
