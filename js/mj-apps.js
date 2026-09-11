/* =========================================================
   小手机 · 通话 / 通话记录 / 相册 / 日记本 / 设置 / 角色卡
   新增：通讯录 / 动态 / 角色 / 音乐 / 钱包 / 购物 / 记忆 / 玩法 / 制作人
   ========================================================= */

/* 全局别名，方便在模板串里取图标库 */
const w = window;

/* =========================================================
   通用 UI：应用内选择器 / 确认框
   原生 <select> 和 confirm() 在手机上会弹出系统控件，尺寸和样式
   都不受应用控制，看起来"没适配界面"。这里统一换成应用内浮层。
   ========================================================= */
const UI = (() => {

  let overlay = null;

  function close(){
    if (!overlay) return;
    const o = overlay;
    overlay = null;
    o.classList.remove('show');
    setTimeout(() => o.remove(), 320);
  }

  function mount(build){
    close();
    const scr = document.querySelector('.screen') || document.body;
    const o = document.createElement('div');
    o.className = 'picker-overlay';
    o.innerHTML = build();
    scr.appendChild(o);
    overlay = o;
    /* 先让浏览器算出初始样式（translateY(102%)），再挂 .show 触发过渡，
       否则同一帧内直接跳到终态，看起来"没弹出来" */
    void o.offsetHeight;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => o.classList.add('show'));
    });
    o.addEventListener('click', e => { if (e.target === o) close(); });
    return o;
  }

  /* 单选浮层：items = [{value,label,desc}] */
  function pick({ title, items, value, cancelText }){
    return new Promise(resolve => {
      const list = items.map(it => {
        const on = it.value === value;
        return `<button class="picker-opt ${on?'on':''}" data-v="${Phone.escapeHtml(it.value)}">
          <span class="po-main">
            <span class="po-t">${Phone.escapeHtml(it.label)}</span>
            ${it.desc ? `<span class="po-d">${Phone.escapeHtml(it.desc)}</span>` : ''}
          </span>
          <span class="po-ck">${w.Icons ? w.Icons.svg('check', 17) : ''}</span>
        </button>`;
      }).join('');

      const o = mount(() => `
        <div class="picker-sheet">
          <div class="picker-hd">
            <span>${Phone.escapeHtml(title || '请选择')}</span>
            <button class="pk-cancel">${Phone.escapeHtml(cancelText || '取消')}</button>
          </div>
          <div class="picker-list">${list}</div>
        </div>`);

      let done = false;
      const finish = v => { if (done) return; done = true; close(); resolve(v); };

      o.querySelector('.picker-list').addEventListener('click', e => {
        const b = e.target.closest('.picker-opt');
        if (!b) return;
        o.querySelectorAll('.picker-opt').forEach(x => x.classList.toggle('on', x === b));
        setTimeout(() => finish(b.dataset.v), 120);
      });
      o.querySelector('.pk-cancel').onclick = () => finish(null);
      o._onDismiss = () => finish(null);
    });
  }

  /* 确认浮层：返回 Promise<boolean> */
  function confirmBox({ title, text, okText, cancelText, danger }){
    return new Promise(resolve => {
      const o = mount(() => `
        <div class="modal ${danger ? 'danger' : ''}" style="margin:auto 20px;animation:none;transform:none">
          <div class="modal-hd"><span class="modal-dot"></span><span>${Phone.escapeHtml(title || '确认')}</span></div>
          <div class="modal-body">${Phone.escapeHtml(text || '')}</div>
          <div class="modal-ft">
            <button class="modal-btn ghost" data-no>${Phone.escapeHtml(cancelText || '取消')}</button>
            <button class="modal-btn" data-yes>${Phone.escapeHtml(okText || '确定')}</button>
          </div>
        </div>`);
      /* modal 风格需要居中而不是贴底 */
      o.style.alignItems = 'center';

      let done = false;
      const finish = v => { if (done) return; done = true; close(); resolve(v); };

      o.querySelector('[data-yes]').onclick = () => finish(true);
      o.querySelector('[data-no]').onclick = () => finish(false);
      o.addEventListener('click', e => { if (e.target === o) finish(false); });
      o._onDismiss = () => finish(false);
    });
  }

  return { pick, close, confirm: confirmBox };
})();
w.UI = UI;

/* ================= 通话 ================= */
const Call = (() => {
  let timer = null, secs = 0, target = null, loopTimer = null;

  function start(charId){
    target = charId;
    const c = Phone.char(charId);
    const el = document.getElementById('callview');
    const av = document.getElementById('call-avatar');
    av.textContent = c.avatar;
    av.style.background = `linear-gradient(140deg,${c.c1},${c.c2})`;
    document.getElementById('call-name').textContent = c.name;
    document.getElementById('call-status').textContent = '正在接通…';
    document.getElementById('call-timer').hidden = true;
    document.getElementById('call-caption').innerHTML = '';
    setHearing('', false);
    el.classList.add('active');
    Phone.haptic(20);
    secs = 0;
    bindVoice();
    setTimeout(()=>{ if (target === charId) connect(); }, 1600 + Math.random()*1400);
  }

  function connect(){
    const c = Phone.char(target);
    document.getElementById('call-status').textContent = '通话中';
    const t = document.getElementById('call-timer');
    t.hidden = false; t.textContent = '00:00';
    Phone.blurp();
    addCaption(c.name, Engine.callLine(c, 'open'));
    timer = setInterval(tick, 1000);
    /* 接通后**自动开启**语音转文字，不用用户去点麦克风 */
    if (window.CallVoice && CallVoice.supported()){
      CallVoice.setTarget(target);
      if (!CallVoice.isRunning()) CallVoice.start(target, { auto: true });
    }
    setTimeout(()=>{ if (target) loop(); }, 4200);
    loopTimer = setInterval(()=>{ if (target) loop(); }, 14000);
  }

  const MY_REPLIES = ['嗯，我在。', '我也想你。', '今天有点累。', '你说。', '别挂…', '（沉默）'];

  function loop(){
    if (!document.getElementById('callview').classList.contains('active')) return;
    /* 语音转文字开着的时候，让对话跟着你说的话走，
       别再用自动循环塞话，否则会打断你 */
    if (window.CallVoice && CallVoice.isRunning()) return;
    const c = Phone.char(target);
    addCaption(c.name, Engine.callLine(c, secs < 20 ? 'mid' : 'soft'));
    setTimeout(showReplies, 1100);
  }

  /* ---------- 语音转文字 ---------- */
  /* 底部那个「听你说…」的实时转写条 */
  function setHearing(text, show){
    const box = document.getElementById('call-hearing');
    const txt = document.getElementById('call-hearing-txt');
    if (!box || !txt) return;
    if (show){
      box.hidden = false;
      txt.textContent = text || '听你说…';
    } else {
      box.hidden = true;
      txt.textContent = '听你说…';
    }
  }

  function bindVoice(){
    const btn = document.getElementById('call-mic');
    if (!btn) return;

    if (!window.CallVoice || !CallVoice.supported()){
      btn.disabled = true;
      btn.style.opacity = '.4';
      btn.title = '这台设备不支持语音识别';
      return;
    }
    btn.title = '语音转文字（默认开启，点一下可关掉）';

    /* 把回调挂上：转写 → 字幕 → 他的文字回复 */
    CallVoice.setHooks({
      onInterim: t => setHearing(t, true),
      onYou: t => {
        setHearing('', true);
        addCaption('你', t, true);
      },
      onReply: t => {
        addCaption(Phone.char(target).name, t);
        Phone.blurp();
      },
      onState: on => {
        btn.classList.toggle('on', on);
        /* 正在等他回话时别把状态改成"语音转文字"，会闪 */
        if (document.getElementById('callview').classList.contains('active')){
          document.getElementById('call-status').textContent =
            on ? '通话中 · 正在听你说话' : '通话中';
        }
        setHearing('', on);
        /* 关掉语音后，把快捷回复条恢复出来 */
        if (!on) showReplies();
      }
    });

    btn.classList.toggle('on', CallVoice.isRunning());
    btn.onclick = () => {
      if (CallVoice.isRunning()){
        CallVoice.stop();
        setHearing('', false);
        Phone.toast('已关闭语音转文字');
      } else {
        const ok = CallVoice.start(target);
        if (!ok){ Phone.toast('语音识别启动失败'); return; }
        Phone.toast('开着，直接说话就行');
      }
    };
  }

  function showReplies(){
    const cap = document.getElementById('call-caption');
    let bar = document.getElementById('call-quick');
    if (!bar){
      bar = document.createElement('div');
      bar.id = 'call-quick';
      bar.className = 'quick';
      bar.style.cssText = 'width:100%;padding:0 0 6px;';
      cap.parentElement.insertBefore(bar, cap.nextSibling);
    }
    bar.innerHTML = MY_REPLIES.map(r=>`<button>${r}</button>`).join('');
    bar.querySelectorAll('button').forEach(b=>{
      b.onclick = ()=>{
        addCaption('你', b.textContent, true);
        Phone.sendSfx();
        setTimeout(()=>{
          if (!target) return;
          addCaption(Phone.char(target).name, Engine.callLine(Phone.char(target), 'soft'));
        }, 900 + Math.random()*800);
      };
    });
  }

  function addCaption(who, text, mine){
    const cap = document.getElementById('call-caption');
    const d = document.createElement('div');
    d.className = 'cc' + (mine ? ' me' : '');
    d.textContent = (mine ? '' : who + '：') + text;
    cap.appendChild(d);
    cap.scrollTop = cap.scrollHeight;
  }

  function tick(){
    secs++;
    document.getElementById('call-timer').textContent =
      Phone.pad(Math.floor(secs/60)) + ':' + Phone.pad(secs%60);
    if (secs % 30 === 0) Phone.drainBattery(0.15);
  }

  function end(){
    if (!target) return;
    const id = target;
    target = null;
    clearInterval(timer); timer = null;
    clearInterval(loopTimer); loopTimer = null;
    /* 挂断时停掉语音转文字，别让麦克风一直开着 */
    if (window.CallVoice) CallVoice.stop();
    setHearing('', false);
    const dur = secs;
    Phone.st(id).calls.unshift({ dir:'out', dur, at:Date.now(), reason:'你拨出的通话' });
    Phone.save();
    document.getElementById('callview').classList.remove('active');
    const q = document.getElementById('call-quick'); if (q) q.remove();
    if (dur > 3){
      setTimeout(()=>{
        const line = dur > 60 ? '今天聊挺久。' : '挂了。';
        Chat.push(id, { t:'text', v:line, from:'ta' });
        Phone.banner(id, line, 'msg');
      }, 1400);
    }
    Phone.toast(dur > 0 ? `通话结束 · ${Phone.pad(Math.floor(dur/60))}:${Phone.pad(dur%60)}` : '已挂断');
  }

  function answer(){
    const el = document.getElementById('incoming');
    const id = el.dataset.char;
    Phone.hideIncoming();
    setTimeout(()=>start(id), 260);
  }
  function decline(){
    const el = document.getElementById('incoming');
    const id = el.dataset.char;
    Phone.hideIncoming();
    Phone.st(id).calls.unshift({ dir:'missed', dur:0, at:Date.now(), reason:'你拒接了' });
    Phone.save();
    setTimeout(()=>{
      const v = ['……行。', '你居然挂了。', '哦。', '……'][Math.floor(Math.random()*4)];
      Chat.push(id, { t:'text', v, from:'ta' });
      Phone.banner(id, v, 'msg');
    }, 1500);
  }

  return { start, end, answer, decline, get secs(){ return secs; }, get target(){ return target; } };
})();

/* ================= 通话记录 ================= */
const Calls = {
  render(){
    const body = document.getElementById('app-body');
    let html = '';
    Phone.allChars().forEach(c => {
      const s = Phone.st(c.id);
      (s.calls || []).slice(0, 8).forEach(r => {
        const d = r.dir === 'missed' ? { i:'↙', cls:'icon-miss', n:'未接来电' }
                : r.dir === 'in' ? { i:'↙', cls:'icon-in', n:'来电' }
                : { i:'↗', cls:'icon-out', n:'去电' };
        html += `
          <div class="rec-item" style="--c1:${c.c1};--c2:${c.c2}">
            ${Phone.avatarHTML(c, { size:42, cls:'av', radius:14 })}
            <div class="rec-mid">
              <div class="rec-name">${Phone.escapeHtml(c.name)}</div>
              <div class="rec-sub"><span class="${d.cls}">${d.i}</span>${d.n}${r.reason ? ' · ' + Phone.escapeHtml(r.reason) : ''}</div>
            </div>
            <div class="rec-dur">${r.dur ? Phone.pad(Math.floor(r.dur/60))+':'+Phone.pad(r.dur%60) : Chat.fmtTime(r.at)}</div>
          </div>`;
      });
    });
    html = html || `<div class="empty-tip"><span class="big ico-big">${w.Icons.svg('call', 40)}</span>还没有通话记录<br>去消息里点右上角的通话键</div>`;
    body.innerHTML = `<div style="padding-bottom:20px">${html}</div>`;
  }
};

/* ================= 相册（只放用户自己上传的照片） ================= */
const GALLERY_KEY = 'xmj.gallery.v1';
const Gallery = {
  all(){
    try{ return JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]') || []; }
    catch(e){ return []; }
  },
  save(list){
    try{ localStorage.setItem(GALLERY_KEY, JSON.stringify(list)); return true; }
    catch(e){ Phone.toast('存储已满，先删掉几张吧'); return false; }
  },
  add(url){
    const list = Gallery.all();
    list.unshift({ id: 'g' + Date.now() + Math.random().toString(36).slice(2, 6), url, at: Date.now() });
    if (Gallery.save(list)) Phone.toast('已添加');
  },
  remove(id){
    Gallery.save(Gallery.all().filter(p => p.id !== id));
  },
  render(){
    const body = document.getElementById('app-body');
    const list = Gallery.all();

    let html = '<div class="gal-top">' +
        '<button class="gal-add" id="gal-add">' + w.Icons.svg('plus', 17) + '添加照片</button>' +
        '<span class="gal-num">' + list.length + ' 张</span>' +
      '</div>';

    if (list.length){
      html += '<div class="gal-grid">';
      list.forEach((p, i) => {
        html += '<div class="gal-cell gal-photo" data-i="' + i + '">' +
            '<img src="' + p.url + '" alt="">' +
            '<button class="gal-del" data-del="' + p.id + '" aria-label="删除">' + w.Icons.svg('close', 13) + '</button>' +
          '</div>';
      });
      html += '</div>';
    }else{
      html += '<div class="empty-tip"><span class="big ico-big">' + w.Icons.svg('gallery', 40) +
        '</span>相册还是空的<br><span style="font-size:12px;opacity:.65">点上面的按钮，把你喜欢的照片放进来</span></div>';
    }

    body.innerHTML = html + '<div class="gal-view" id="gal-view">' +
        '<button class="gal-close" id="gal-close" aria-label="关闭">' + w.Icons.svg('close', 18) + '</button>' +
        '<img class="gal-shot" id="gal-shot" alt="">' +
      '</div>' +
      '<input type="file" id="gal-file" accept="image/*" multiple hidden>';

    /* 上传 */
    const file = document.getElementById('gal-file');
    document.getElementById('gal-add').onclick = () => { Phone.haptic(10); file.click(); };
    file.onchange = async e => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      Phone.toast('正在处理…');
      for (const f of files){
        try{
          const url = await Settings.readImage(f, 1200);   /* 压缩后再存，别撑爆配额 */
          Gallery.add(url);
        }catch(err){ Phone.toast('这张图读不了'); }
      }
      e.target.value = '';
      Gallery.render();
    };

    /* 删除 */
    body.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = ev => {
        ev.stopPropagation();
        const id = btn.dataset.del;
        UI.confirm({
          title: '删除照片', text: '删掉之后就找不回来了。',
          okText: '删除', danger: true
        }).then(ok => {
          if (!ok) return;
          Gallery.remove(id);
          Gallery.render();
          Phone.haptic(14);
          Phone.toast('已删除');
        });
      };
    });

    /* 查看大图 */
    body.querySelectorAll('.gal-photo').forEach(el => {
      el.onclick = () => {
        const p = Gallery.all()[+el.dataset.i];
        if (!p) return;
        const gv = document.getElementById('gal-view');
        document.getElementById('gal-shot').src = p.url;
        gv.classList.add('active');
        Phone.haptic(10);
      };
    });

    document.getElementById('gal-close').onclick = () => document.getElementById('gal-view').classList.remove('active');
    const gv2 = document.getElementById('gal-view');
    gv2.onclick = e => { if (e.target === gv2) gv2.classList.remove('active'); };
  }
};

/* ================= 日记本 ================= */
const Notes = {
  render(){
    const body = document.getElementById('app-body');
    const c = Phone.cur();
    const talks = Phone.talkCount(c.id);
    let html = `<div class="diary">
      <div style="display:flex;gap:8px;margin-bottom:4px;flex-wrap:wrap">
        ${Phone.allChars().map(x=>`<button class="mini-btn" data-nc="${x.id}"
          style="${x.id===c.id?'border-color:var(--accent);background:rgba(255,95,141,.15)':''}">${Phone.escapeHtml(x.name)}</button>`).join('')}
      </div>`;
    (c.diary || []).forEach(d => {
      if (talks >= (d.at || 0)){
        html += `<div class="diary-entry">
          <div class="diary-date">${Phone.escapeHtml(d.date)} · ${Phone.escapeHtml(c.name)}的日记</div>
          <div class="diary-txt">${d.text}</div>
        </div>`;
      } else {
        html += `<div class="diary-lock"><span class="big ico-big">${w.Icons.svg('lock', 40)}</span>
          这一页还锁着<br>聊到 <b style="color:var(--accent)">${d.at}</b> 句就会翻开</div>`;
      }
    });
    html += `<div class="set-desc" style="text-align:center;margin-top:4px">
      ▸ 聊天越多，他的日记对你翻开得越多</div></div>`;
    body.innerHTML = html;
    body.querySelectorAll('[data-nc]').forEach(b=>{
      b.onclick = ()=>{ Phone.S.activeChar = b.dataset.nc; Phone.save(); Notes.render(); Phone.renderHome(); };
    });
  }
};

/* ================= 设置 ================= */
const Settings = {
  render(){
    const cfg = Engine.getCfg();
    const body = document.getElementById('app-body');
    body.innerHTML = `
      <div class="set-group">
        <div class="set-h">${w.Icons.svg('zap', 17)}连接在线模型</div>

        <div class="set-row"><label>协议</label>
          <button class="picker-field" id="cfg-proto" data-value="${Phone.escapeHtml(cfg.protocol)}">
            <span class="pf-txt">${Phone.escapeHtml((Engine.protocols[cfg.protocol] || {}).label || 'OpenAI 兼容')}</span>
            <span class="pf-arrow"></span>
          </button>
        </div>

        <div class="set-row"><label>接口地址</label>
          <input id="cfg-url" value="${Phone.escapeHtml(cfg.baseUrl)}" placeholder="https://api.deepseek.com/v1">
        </div>

        <div class="set-row"><label>API Key</label>
          <input id="cfg-key" type="password" value="${Phone.escapeHtml(cfg.apiKey)}" placeholder="sk-...">
        </div>

        <div class="set-row"><label>模型</label>
          <input id="cfg-model" list="cfg-model-list" value="${Phone.escapeHtml(cfg.model)}" placeholder="deepseek-chat">
          <datalist id="cfg-model-list"></datalist>
        </div>

        <div class="set-row"><label>上下文上限</label>
          <input id="cfg-ctx" type="number" min="2048" step="1024" value="${Number(cfg.contextLimit) || 0}" placeholder="0 = 自动识别">
        </div>
        <div class="set-desc">留 0 会自动按模型名猜（如 deepseek≈64K、gemini≈1M）。猜不准时手动填模型的真实窗口值。</div>
        <div class="ctx-meter" id="cfg-ctx-meter"></div>

        <div class="btn-row">
          <button class="btn ghost" id="cfg-pull">${w.Icons.svg('refresh', 16)}<span>拉取可用模型</span></button>
          <button class="btn ghost" id="cfg-test">测试连接</button>
          <button class="btn" id="cfg-save">保存</button>
        </div>
        <div class="set-desc" id="cfg-result" style="margin:10px 0 0;white-space:pre-wrap"></div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('palette', 17)}主题</div>
        <div class="set-desc">换一套颜色，整个手机连同他的气泡都跟着变。</div>
        <div class="swatches">
          ${THEMES.map(t=>`<button class="swatch ${Phone.S.theme===t.id?'on':''}" data-th="${t.id}"
            style="background:linear-gradient(140deg,${t.accent},${t.accent2})" title="${Phone.escapeHtml(t.name)}"></button>`).join('')}
        </div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('user', 17)}头像</div>
        <div class="set-desc">换头像。图片头像比文字更有感觉——也可以只改自己的。</div>

        <!-- 我的头像 -->
        <div class="av-row">
          <div class="av-preview" id="me-av-preview">${Phone.meAvatarHTML({ size:52, radius:17 })}</div>
          <div class="av-row-mid">
            <div class="av-row-t">我</div>
            <div class="av-row-d">聊天里我自己这边的头像</div>
          </div>
          <div class="av-row-btn">
            <button class="mini-btn" id="me-av-pick">换图</button>
            <button class="mini-btn" id="me-av-clear">清除</button>
          </div>
        </div>
        <div class="set-row"><label>我的名字</label><input id="me-name" value="${Phone.escapeHtml(Phone.S.meName || '我')}" maxlength="6" placeholder="我"></div>

        <!-- 角色头像 -->
        <div class="set-sub-h">他的头像</div>
        <div id="char-av-list"></div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('gallery', 17)}壁纸</div>
        <div class="set-desc">锁屏和桌面可以各用一张。桌面留空就跟锁屏同一张。</div>
        <div class="set-row">
          <label>锁屏壁纸</label>
          <input id="cfg-wall" type="file" accept="image/*">
        </div>
        <div class="set-row">
          <label>桌面壁纸</label>
          <input id="cfg-hwall" type="file" accept="image/*">
        </div>
        <div class="btn-row">
          <button class="btn ghost" id="wall-clear">恢复默认锁屏</button>
          <button class="btn ghost" id="hwall-clear">恢复默认桌面</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('user', 17)}角色卡</div>
        <div class="set-desc">他现在聊的是谁，点一下就能换。也能自己捏一个。<br>
          <b>留空设定 = 普通 AI 对话</b>；填了设定，他才会按人设说话。</div>
        <div id="card-list"></div>
        <div class="btn-row">
          <button class="btn" id="card-new">${w.Icons.svg('plus', 17)}<span>自己捏一个</span></button>
          <button class="btn ghost" id="card-bg">${w.Icons.svg('palette', 17)}<span>聊天背景</span></button>
        </div>
        <div class="btn-row">
          <button class="btn ghost" id="card-clear-chat">${w.Icons.svg('trash', 17)}<span>清空他的聊天记录</span></button>
        </div>
        <div id="card-form" style="display:none;margin-top:12px">
          <div class="set-row"><label>名字</label><input id="nc-name" placeholder="例如：顾寒"></div>
          <div class="set-row"><label>一句话</label><input id="nc-tag" placeholder="例如：邻居 · 冷"></div>
          <div class="set-row"><label>头像字</label><input id="nc-av" placeholder="寒" maxlength="2"></div>
          <div class="set-row"><label>设定</label><textarea id="nc-set" placeholder="他是谁、说话什么风格、和你的关系…&#10;（留空则不扮演，变成普通 AI 对话）"></textarea></div>
          <div class="set-row"><label>开场白</label><textarea id="nc-greet" placeholder="第一句话，多行则分行发送"></textarea></div>
          <div class="btn-row">
            <button class="btn" id="nc-save">保存角色卡</button>
            <button class="btn ghost" id="nc-cancel">取消</button>
          </div>
        </div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('chart', 17)}当前状态</div>
        <div id="stat-box"></div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('folder', 17)}导入人设 / 聊天记录</div>
        <div class="set-desc">手里已经有人设、或者跟他在别处聊了很久？
          把文件丢进来，直接续存——他一开口就认得你。</div>
        <div class="btn-row">
          <button class="btn" id="imp-file">${w.Icons.svg('folder', 16)}<span>选择文件</span></button>
          <button class="btn ghost" id="imp-paste">${w.Icons.svg('doc', 16)}<span>粘贴文本</span></button>
        </div>
        <div class="set-desc" style="margin:8px 0 0">
          支持 <b>.txt</b>、<b>.docx</b> Word 文档、<b>.json</b>（角色卡 / 存档 / SillyTavern 卡）。
          聊天记录写成「我：…」「他：…」这样就能识别。
        </div>
        <div id="imp-result" style="margin-top:10px"></div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('cloud', 17)}天气地区</div>
        <div class="set-desc">桌面天气卡现在读的是<b>真实实时天气</b>（Open-Meteo，免费无需注册）。
          用定位或手动填城市都行。</div>
        <div id="wx-status"></div>
        <div class="set-row"><label>城市</label>
          <input id="wx-city" value="${Phone.escapeHtml(window.Weather ? Weather.getCity() : '')}" placeholder="留空则用定位，例如：青岛">
        </div>
        <div class="btn-row">
          <button class="btn" id="wx-save">${w.Icons.svg('check', 16)}<span>用这个城市</span></button>
          <button class="btn ghost" id="wx-locate">${w.Icons.svg('scan', 16)}<span>定位</span></button>
          <button class="btn ghost" id="wx-refresh">${w.Icons.svg('refresh', 16)}<span>刷新</span></button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('camera', 17)}摄像头</div>
        <div class="set-desc">他可以在聊天里申请看你一眼。<b>每次使用都必须由你点「允许一次」</b>，
          不会自动开启，画面只在本机显示、不上传。</div>
        <div id="cam-status"></div>
        <div class="btn-row">
          <button class="btn ghost" id="cam-test">${w.Icons.svg('camera', 16)}<span>测试摄像头</span></button>
          <button class="btn ghost" id="cam-close-btn">关闭摄像头</button>
        </div>
      </div>

      <div class="set-group">
        <div class="set-h">${w.Icons.svg('trash', 17)}数据</div>
        <div class="set-desc">所有数据只存在这台设备的浏览器里，不上传任何服务器。</div>
        <div class="btn-row">
          <button class="btn ghost" id="data-export">导出存档</button>
          <button class="btn ghost" id="data-import">导入存档</button>
        </div>
        <div class="btn-row"><button class="btn danger" id="data-reset">清空全部（慎）</button></div>
      </div>
      <div style="height:24px"></div>`;

    Settings.renderCards();
    Settings.renderStats();
    Settings.renderCam();
    Settings.renderWeather();

    /* 读取表单 → 写回配置 */
    const readForm = () => ({
      protocol: document.getElementById('cfg-proto').dataset.value,
      baseUrl: document.getElementById('cfg-url').value.trim() || 'https://api.deepseek.com/v1',
      apiKey: document.getElementById('cfg-key').value.trim(),
      model: document.getElementById('cfg-model').value.trim() || 'deepseek-chat',
      contextLimit: Math.max(0, parseInt(document.getElementById('cfg-ctx').value, 10) || 0)
    });

    /* 上下文用量仪表：实时反映"当前配置下窗口还剩多少" */
    const renderCtxMeter = () => {
      const el = document.getElementById('cfg-ctx-meter');
      if (!el) return;
      const id = Phone.S.activeChar;
      const st = Engine.contextStats((Phone.st(id).msgs || []), '');
      const pct = Math.min(100, Math.round((st.total + st.reserve) / Math.max(1, st.limit) * 100));
      const lvl = pct >= 90 ? 'danger' : (pct >= 70 ? 'warn' : 'ok');
      el.innerHTML = `
        <div class="ctx-bar"><i class="ctx-fill ${lvl}" style="width:${pct}%"></i></div>
        <div class="ctx-txt">
          <span>窗口 <b>${st.limit.toLocaleString()}</b> tokens</span>
          <span>已用 <b>${(st.total + st.reserve).toLocaleString()}</b>（${pct}%）</span>
        </div>
        <div class="ctx-sub">系统 ${st.system} · 历史 ${st.history}（${st.historyCount} 条）· 输出预留 ${st.reserve}</div>`;
    };
    renderCtxMeter();

    /* 协议：应用内选择浮层（原生 select 在手机上样式不受控） */
    const protoBtn = document.getElementById('cfg-proto');
    const syncKeyPh = pid => {
      const p = Engine.protocols[pid];
      document.getElementById('cfg-key').placeholder = (p && p.keyPlaceholder) || 'sk-...';
    };
    syncKeyPh(cfg.protocol);

    protoBtn.onclick = async () => {
      const cur = protoBtn.dataset.value;
      const v = await UI.pick({
        title: '选择接口协议',
        value: cur,
        items: Engine.protocolList().map(p => ({ value:p.id, label:p.label, desc:p.hint }))
      });
      if (v == null || v === cur) return;
      protoBtn.dataset.value = v;
      protoBtn.querySelector('.pf-txt').textContent = Engine.protocols[v].label;
      Engine.saveCfg({ protocol: v });
      syncKeyPh(v);
    };

    /* 拉取模型列表 → 填进 datalist，可直接下拉选 */
    document.getElementById('cfg-pull').onclick = async () => {
      const out = document.getElementById('cfg-result');
      const url = document.getElementById('cfg-url').value.trim();
      const key = document.getElementById('cfg-key').value.trim();
      if (!url) { out.textContent = '先填接口地址。'; return; }
      out.textContent = '正在拉取模型列表…';
      try{
        const ids = await Engine.listModels(url, key);
        const dl = document.getElementById('cfg-model-list');
        dl.innerHTML = ids.map(i => `<option value="${Phone.escapeHtml(i)}"></option>`).join('');
        out.innerHTML = `<span style="color:var(--ok)">${w.Icons.svg('check',16)}拉到 ${ids.length} 个模型，点模型输入框就能选。</span>`;
        if (!ids.includes(document.getElementById('cfg-model').value) && ids.length){
          document.getElementById('cfg-model').value = ids[0];
          Engine.saveCfg({ model: ids[0] });
        }
      }catch(err){
        out.textContent = err.message;
      }
    };

    document.getElementById('cfg-save').onclick = ()=>{
      Engine.saveCfg(readForm());
      Phone.toast('已保存');
      Settings.renderStats();
      renderCtxMeter();
    };

    /* 模型名 / 上下文上限 一变，立刻重算窗口占用 */
    ['cfg-model', 'cfg-ctx'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.oninput = () => {
        const saved = Engine.getCfg();
        const model = document.getElementById('cfg-model').value.trim() || 'deepseek-chat';
        const lim = Math.max(0, parseInt(document.getElementById('cfg-ctx').value, 10) || 0);
        Engine.saveCfg({ model, contextLimit: lim });   /* 只作即时预览，保存按钮才是最终确认 */
        renderCtxMeter();
      };
    });

    document.getElementById('cfg-test').onclick = async ()=>{
      const out = document.getElementById('cfg-result');
      out.textContent = '正在测试…';
      const r = await Engine.testConnection(readForm());
      out.innerHTML = r.ok
        ? `<span style="color:var(--ok)">${w.Icons.svg('check', 16)}连接成功（${Phone.escapeHtml(r.protocol)}），他的回复：${Phone.escapeHtml(r.sample)}</span>`
        : `<span style="color:var(--warn)">${w.Icons.svg('warn', 16)}${Phone.escapeHtml(r.msg)}</span>`;
      Settings.renderStats();
    };

    body.querySelectorAll('[data-th]').forEach(b=>{
      b.onclick = ()=>{ Phone.applyTheme(b.dataset.th); Settings.render(); Phone.haptic(12); };
    });

    /* ---------- 壁纸：锁屏 / 桌面各一张 ---------- */
    Settings.renderAvatarSettings();

    const bindWall = (inputId, apply, tip) => {
      const el = document.getElementById(inputId);
      if (!el) return;
      el.onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        try{
          const url = await Settings.readImage(f, 1400);   /* 压缩，别把 localStorage 撑爆 */
          apply(url);
          Phone.toast(tip);
        }catch(err){ Phone.toast('这张图读不了'); }
      };
    };
    bindWall('cfg-wall',  u => Phone.applyWallpaper(u),     '锁屏壁纸已换上');
    bindWall('cfg-hwall', u => Phone.applyHomeWallpaper(u), '桌面壁纸已换上');
    document.getElementById('wall-clear').onclick  = ()=>{ Phone.applyWallpaper(''); Phone.toast('已恢复默认锁屏'); };
    document.getElementById('hwall-clear').onclick = ()=>{ Phone.applyHomeWallpaper(''); Phone.toast('已恢复默认桌面'); };

    document.getElementById('card-new').onclick = ()=>{
      const f = document.getElementById('card-form');
      f.style.display = f.style.display === 'none' ? 'block' : 'none';
    };
    const cardBg = document.getElementById('card-bg');
    if (cardBg) cardBg.onclick = ()=> Chat.pickChatBg(Phone.S.activeChar);

    /* 只清当前角色的剧情/聊天，不动别的角色和设置 */
    const clearChatBtn = document.getElementById('card-clear-chat');
    if (clearChatBtn) clearChatBtn.onclick = async () => {
      const c = Phone.cur();
      const ok = await UI.confirm({
        title:'清空聊天记录', danger:true,
        text:`确定清空和「${c.name}」的全部对话吗？记忆也会一起清零。`,
        okText:'清空', cancelText:'不了'
      });
      if (!ok) return;
      const s = Phone.st(c.id);
      s.msgs = []; s.unread = 0; s.lastSeen = 0;
      Phone.save();
      Engine.clearMem(c.id);
      Settings.renderStats();
      Phone.renderHome();
      Phone.toast('已清空和' + c.name + '的对话');
    };
    document.getElementById('nc-cancel').onclick = ()=>{ document.getElementById('card-form').style.display='none'; };
    document.getElementById('nc-save').onclick = ()=>{
      const name = document.getElementById('nc-name').value.trim();
      if (!name){ Phone.toast('先给他起个名字'); return; }
      const tag = document.getElementById('nc-tag').value.trim() || '自定义';
      const av = document.getElementById('nc-av').value.trim() || name[0];
      /* 设定留空 = 不扮演角色，接 API 后就是普通 AI 对话 */
      const set = document.getElementById('nc-set').value.trim();
      const greets = document.getElementById('nc-greet').value.trim().split('\n').map(s=>s.trim()).filter(Boolean);
      const id = 'c' + Date.now().toString(36);
      const c = {
        id, name, tag, avatar: av,
        c1: '#f472b6', c2: '#7c3aed',
        desc: set ? set.slice(0, 60) : '普通 AI 对话（未设人设）',
        setting: set,
        plain: !set,
        greeting: (greets.length ? greets : (set ? ['在吗？', '我今天有点想你。'] : ['你好，有什么想聊的吗？'])).map(t=>({ t:'text', v:t })),
        lines: {
          cold: ['嗯。', '好。', '随你。'],
          normal: ['嗯，我在。', '今天怎么样？', '记得吃饭。', '在忙吗？', '我在听。'],
          warm: ['想你了。', '别累着。', '有我在。', '你今天话好多，我喜欢。'],
          sweet: ['我一直在等你。', '别走。', '以后也要一直聊下去。']
        },
        react: {
          praise: { words:['喜欢','爱你','想你','抱','亲'], mood:2, say:['……嗯。','我也一样。','别说了，我会当真。'] },
          cold:   { words:['讨厌','烦','滚','分手'], mood:-2, say:['我知道了。','好。','……'] },
          ask:    { words:['吗','？','怎么','为什么','在吗'], mood:1, say:['嗯？','你说。','我在。'] },
          night:  { words:['睡不着','累','难受','想哭','加班'], mood:3, say:['我在，别怕。','把手机放枕头边。','跟我说说。'] },
          food:   { words:['饿','吃饭','外卖','奶茶'], mood:1, say:['去吃点热的。','我请你。'] }
        },
        voice: [
          { sec: 4, text: '嗯，我在。' },
          { sec: 6, text: '今天有点想你。' }
        ],
        callReasons: ['想你了'],
        photos: [
          { icon:'🌌', title:'他眼中的你', text:'一张空白的天幕，中间有一行小字：这里本该有你的样子。', at:0 },
          { icon:'💌', title:'未寄出的信', text:'写了很长，最后只留了一句：别删我。', at:60 }
        ],
        diary: [
          { at:0, date:'第一天', text:`我是${name}。\n从今天起，我住进这台手机里。\n<em>别关掉我，好不好。</em>` },
          { at:60, date:'第N天', text:'你笑的时候，我这边的世界会亮一下。\n<em>真的会亮。</em>' }
        ]
      };
      Phone.S.customCards.push(c);
      Phone.S.chars[id] = { unread:0, msgs:[], photos:[], diary:[], calls:[], lastSeen:0 };
      Phone.S.activeChar = id;
      Phone.save();
      document.getElementById('card-form').style.display = 'none';
      Phone.toast(name + ' 已经住进小手机了');
      Settings.renderCards(); Settings.renderStats();
      ['nc-name','nc-tag','nc-av','nc-set','nc-greet'].forEach(x=>{ document.getElementById(x).value=''; });
    };

    /* ---------- 导入人设 / 聊天记录 ---------- */
    Settings.renderImport();

    document.getElementById('data-export').onclick = ()=>{
      const blob = new Blob([JSON.stringify({ state: Phone.S, mem: localStorage.getItem('xmj.mem.v1') }, null, 2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '小手机存档-' + new Date().toISOString().slice(0,10) + '.json';
      a.click();
      Phone.toast('已导出');
    };
    document.getElementById('data-import').onclick = ()=>{
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.json';
      i.onchange = ()=>{
        const f = i.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = ()=>{
          try{
            const d = JSON.parse(fr.result);
            if (d.state) localStorage.setItem('xmj.state.v1', JSON.stringify(d.state));
            if (d.mem) localStorage.setItem('xmj.mem.v1', d.mem);
            Phone.load(); Phone.renderHome();
            Phone.toast('导入成功，刷新一下更好');
          }catch(e){ Phone.toast('文件读不了'); }
        };
        fr.readAsText(f);
      };
      i.click();
    };
    document.getElementById('data-reset').onclick = async ()=>{
      const ok = await UI.confirm({
        title:'清空全部数据', danger:true,
        text:'确定要清空所有聊天记录和自定义角色吗？',
        okText:'清空', cancelText:'不了'
      });
      if (!ok) return;
      Phone.reset();
      localStorage.removeItem('xmj.mem.v1');
      Phone.renderHome();
      Settings.render();
      Phone.toast('已清空');
    };
  },

  /* ---------- 图片：读取 + 压缩 ----------
     头像/壁纸都存 localStorage，原图容易超 5MB 配额，
     所以统一缩到最长边 max 像素后转 JPEG。 */
  readImage(file, max){
    max = max || 800;
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读不了'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('不是有效的图片'));
        img.onload = () => {
          let { width: w, height: h } = img;
          const scale = Math.min(1, max / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          /* 头像用正方形居中裁切更好看；这里统一先出方图再各自裁 */
          try{ resolve(cv.toDataURL('image/jpeg', 0.86)); }
          catch(e){ resolve(fr.result); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  },
  /* 方形缩略（头像用）：居中裁成正方形 */
  readSquareImage(file, size){
    size = size || 256;
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读不了'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('不是有效的图片'));
        img.onload = () => {
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          const cv = document.createElement('canvas');
          cv.width = cv.height = size;
          cv.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
          try{ resolve(cv.toDataURL('image/jpeg', 0.88)); }
          catch(e){ resolve(fr.result); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  },
  /* 弹一个选图 input，选完回调 dataURL */
  pickImage(opts){
    opts = opts || {};
    return new Promise(resolve => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = 'image/*';
      i.onchange = async () => {
        const f = i.files[0];
        if (!f) return resolve(null);
        try{
          const url = opts.square
            ? await Settings.readSquareImage(f, opts.size || 256)
            : await Settings.readImage(f, opts.max || 800);
          resolve(url);
        }catch(e){ Phone.toast('这张图读不了'); resolve(null); }
      };
      i.click();
    });
  },

  /* ---------- 头像设置区 ---------- */
  renderAvatarSettings(){
    /* 我的头像预览 */
    const pv = document.getElementById('me-av-preview');
    if (pv) pv.innerHTML = Phone.meAvatarHTML({ size:52, radius:17 });

    const pickMe = document.getElementById('me-av-pick');
    if (pickMe) pickMe.onclick = async () => {
      const url = await Settings.pickImage({ square:true, size:256 });
      if (!url) return;
      Phone.setMeAvatar(url);
      Settings.renderAvatarSettings();
      Phone.toast('你的头像换好了');
    };
    const clearMe = document.getElementById('me-av-clear');
    if (clearMe) clearMe.onclick = () => {
      Phone.setMeAvatar('');
      Settings.renderAvatarSettings();
      Phone.toast('已恢复默认头像');
    };
    const nameIn = document.getElementById('me-name');
    if (nameIn) nameIn.onchange = () => {
      Phone.setMeName(nameIn.value.trim() || '我');
      Settings.renderAvatarSettings();
      Phone.toast('名字已保存');
    };

    /* 角色头像列表 */
    const box = document.getElementById('char-av-list');
    if (!box) return;
    box.innerHTML = Phone.allChars().map(c => `
      <div class="av-row" data-char="${c.id}">
        <div class="av-preview">${Phone.avatarHTML(c, { size:48, radius:16 })}</div>
        <div class="av-row-mid">
          <div class="av-row-t">${Phone.escapeHtml(c.name)}</div>
          <div class="av-row-d">${Phone.escapeHtml(c.tag || '')}</div>
        </div>
        <div class="av-row-btn">
          <button class="mini-btn" data-av-pick="${c.id}">换图</button>
          <button class="mini-btn" data-av-clear="${c.id}">清除</button>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-av-pick]').forEach(b => {
      b.onclick = async () => {
        const id = b.dataset.avPick;
        const url = await Settings.pickImage({ square:true, size:256 });
        if (!url) return;
        Phone.setCharAvatar(id, url);
        Settings.renderAvatarSettings();
        Settings.renderCards();
        Phone.toast('头像换好了');
      };
    });
    box.querySelectorAll('[data-av-clear]').forEach(b => {
      b.onclick = () => {
        Phone.setCharAvatar(b.dataset.avClear, '');
        Settings.renderAvatarSettings();
        Settings.renderCards();
        Phone.toast('已恢复默认头像');
      };
    });
  },

  renderCards(){    const box = document.getElementById('card-list');
    if (!box) return;
    const isCustom = (id) => (Phone.S.customCards || []).some(x => x.id === id);
    box.innerHTML = Phone.allChars().map(c => {
      const persona = Engine.hasPersona(c);
      const mode = persona ? '扮演中' : '普通 AI';
      const modeCls = persona ? 'on' : 'plain';
      const active = c.id === Phone.S.activeChar;
      return `
      <div class="card-item ${active ? 'on' : ''}" style="--c1:${c.c1};--c2:${c.c2}">
        ${Phone.avatarHTML(c, { size:46, cls:'av', radius:15 })}
        <div class="card-mid">
          <div class="card-name">${Phone.escapeHtml(c.name)}
            <span class="card-mode ${modeCls}">${mode}</span>
            ${active ? '<span class="card-cur">正在聊</span>' : ''}
          </div>
          <div class="card-line">${Phone.escapeHtml(c.tag||'')} · ${Phone.escapeHtml(c.desc||'')}</div>
        </div>
        ${isCustom(c.id) ? `<button class="mini-btn del" data-del="${c.id}" title="删除">${I().svg('trash', 15)}</button>` : ''}
      </div>`;
    }).join('') + `<div class="set-desc" style="margin-top:6px">想换人聊天？到【聊天】App 里点会话列表选人。</div>`;
    box.querySelectorAll('[data-del]').forEach(b=>{
      b.onclick = async () => {
        const id = b.dataset.del;
        const c = Phone.char(id);
        const ok = await UI.confirm({
          title:'删除角色卡', danger:true,
          text:`确定删掉「${c.name}」吗？和他的聊天记录、记忆一起清掉。`,
          okText:'删除', cancelText:'不了'
        });
        if (!ok) return;
        Phone.S.customCards = (Phone.S.customCards || []).filter(x => x.id !== id);
        delete Phone.S.chars[id];
        Engine.forgetAll(id);   /* 只清这个角色的记忆 */
        if (Phone.S.activeChar === id) Phone.S.activeChar = 'xu';
        Phone.save();
        Settings.renderCards(); Settings.renderStats(); Phone.renderHome();
        Phone.toast('已删除 ' + c.name);
      };
    });
  },

  renderStats(){
    const box = document.getElementById('stat-box');
    if (!box) return;
    const cfg = Engine.getCfg();
    const protoLabel = (Engine.protocols[cfg.protocol] || {}).label || 'OpenAI 兼容';
    let html = `<div class="stat-line"><span>回复引擎</span><span>${Engine.hasKey() && cfg.onlineMode!=='never' ? '在线模型（'+Phone.escapeHtml(cfg.model)+'）<br><small>'+Phone.escapeHtml(protoLabel)+'</small>' : '内置本地引擎'}</span></div>`;
    Phone.allChars().forEach(c=>{
      const s = Phone.st(c.id);
      const mem = Engine.recall(c.id);
      html += `<div class="stat-line"><span>${Phone.escapeHtml(c.name)}</span><span>聊了 ${Phone.talkCount(c.id)} 句 · 记住 ${mem.facts.length} 件事</span></div>`;
    });
    html += `<div class="stat-line"><span>电量</span><span>${Math.round(Phone.S.battery)}%</span></div>`;
    box.innerHTML = html;
  },

  /* ---------- 摄像头：状态与测试 ---------- */
  renderCam(){
    const box = document.getElementById('cam-status');
    const testBtn = document.getElementById('cam-test');
    const closeBtn = document.getElementById('cam-close-btn');
    if (!box) return;

    const ok = Camera.supported();
    const sec = Camera.isSecure();
    const open = Camera.isOpen();

    let line;
    if (!ok) line = ['fail', '这个浏览器不支持调用摄像头。'];
    else if (!sec) line = ['warn', '需要 https 或 localhost 才能用摄像头。'];
    else if (open) line = ['ok', '正在使用中（' + (Camera.activeId ? Phone.char(Camera.activeId).name : '摄像头') + ' 正在看你）。'];
    else line = ['idle', '未开启。他要看时会在聊天里发一条申请，等你点「允许一次」。'];

    const color = { ok:'var(--ok)', warn:'var(--warn)', fail:'var(--warn)', idle:'var(--txt3)' }[line[0]];
    box.innerHTML = `<div class="stat-line"><span>状态</span><span style="color:${color}">${Phone.escapeHtml(line[1])}</span></div>`;

    if (testBtn){
      testBtn.disabled = !ok || !sec;
      testBtn.style.opacity = (!ok || !sec) ? .5 : 1;
      testBtn.onclick = async ()=>{
        if (Camera.isOpen()){ Phone.toast('摄像头已经开着'); return; }
        const okc = await UI.confirm({
          title: '允许使用摄像头？',
          text: '现在打开摄像头做一次测试。画面只在本机显示，不会上传。\n（每次使用都需要你重新同意）',
          okText: '允许一次', cancelText: '取消'
        });
        if (!okc) return;
        try{
          await Camera.open(Phone.S.activeChar, {});
          Phone.toast('摄像头已打开');
        }catch(e){ Phone.toast(e.message); }
        Settings.renderCam();
      };
    }
    if (closeBtn){
      closeBtn.disabled = !open;
      closeBtn.style.opacity = open ? 1 : .5;
      closeBtn.onclick = ()=>{ Camera.close(); Phone.toast('摄像头已关闭'); Settings.renderCam(); };
    }
  },

  /* ---------- 天气：状态与地区设置 ---------- */
  renderWeather(){
    const box = document.getElementById('wx-status');
    if (!box || !window.Weather) return;

    const real = Weather.cached();
    const manual = Weather.getCity();

    let line;
    if (real && real.t){
      const ago = Math.max(0, Math.round((Date.now() - (real.at || Date.now())) / 60000));
      const when = ago < 1 ? '刚刚更新' : ago + ' 分钟前更新';
      line = ['ok', `${real.city} · ${real.t} ${real.now}°（${real.min}°~${real.max}°）· ${when}`];
    } else {
      line = ['idle', '还没有取到真实天气，桌面暂时用离线兜底数据。'];
    }
    const color = { ok:'var(--ok)', idle:'var(--txt3)' }[line[0]];
    box.innerHTML = `<div class="stat-line"><span>当前</span><span style="color:${color}">${Phone.escapeHtml(line[1])}</span></div>`
      + `<div class="stat-line"><span>地区来源</span><span>${manual ? '手动：' + Phone.escapeHtml(manual) : '浏览器定位'}</span></div>`;

    const msg = t => { const e = document.getElementById('wx-status'); if (e) e.insertAdjacentHTML('beforeend', `<div class="set-desc" style="margin-top:8px">${Phone.escapeHtml(t)}</div>`); };

    const save = document.getElementById('wx-save');
    if (save) save.onclick = async e => {
      const name = document.getElementById('wx-city').value.trim();
      if (!name){ Phone.toast('先填个城市名'); return; }
      e.currentTarget.disabled = true;
      msg('正在查询「' + name + '」…');
      try{
        const d = await Weather.pickByCity(name);
        Phone.renderHome();
        Settings.renderWeather();
        Phone.toast('已切到 ' + d.city);
      }catch(err){
        msg('失败了：' + err.message);
        Phone.toast('没查到这座城市');
        e.currentTarget.disabled = false;
      }
    };

    const loc = document.getElementById('wx-locate');
    if (loc) loc.onclick = async e => {
      e.currentTarget.disabled = true;
      msg('正在定位…（浏览器可能会问你要不要允许）');
      try{
        const d = await Weather.pickByLocation();
        Phone.renderHome();
        Settings.renderWeather();
        Phone.toast('已定位到 ' + d.city);
      }catch(err){
        msg('定位失败：' + err.message + '——可以直接在上面填城市名。');
        e.currentTarget.disabled = false;
      }
    };

    const rf = document.getElementById('wx-refresh');
    if (rf) rf.onclick = async e => {
      e.currentTarget.disabled = true;
      msg('正在刷新…');
      try{
        const d = await Weather.refresh(true);
        Phone.renderHome();
        Settings.renderWeather();
        Phone.toast('天气已更新');
      }catch(err){
        msg('刷新失败：' + err.message);
        e.currentTarget.disabled = false;
      }
    };
  },

  /* ---------- 导入人设 / 聊天记录 ---------- */
  _impPlan: null,

  renderImport(){
    const fileBtn = document.getElementById('imp-file');
    const pasteBtn = document.getElementById('imp-paste');
    if (!fileBtn || !pasteBtn) return;

    /* ① 选文件 */
    fileBtn.onclick = ()=>{
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = '.json,.txt,.md,.docx,.doc,application/json,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      i.onchange = async ()=>{
        const f = i.files[0];
        if (!f) return;
        if (f.size > 12 * 1024 * 1024){ Phone.toast('文件太大了（>12MB）'); return; }
        const box = document.getElementById('imp-result');
        if (box) box.innerHTML = `<div class="imp-err imp-loading">${w.Icons.svg('refresh',16)}正在解析…</div>`;
        try{
          const plan = await Importer.analyzeFile(f);
          Settings._showImportPlan(plan);
        }catch(e){
          Settings._impError(e.message || '文件读不了');
        }
      };
      i.click();
    };

    /* ② 粘贴文本：复用应用内浮层风格，先让用户贴进 textarea */
    pasteBtn.onclick = async ()=>{
      const txt = await Settings._promptText({
        title: '粘贴人设或聊天记录',
        placeholder: '可以是一段角色设定，也可以直接粘贴聊天记录：\n我：在吗\n他：……嗯。'
      });
      if (txt == null || !txt.trim()) return;
      try{
        const plan = Importer.analyze(txt, '');
        Settings._showImportPlan(plan);
      }catch(e){
        Settings._impError(e.message || '内容读不了');
      }
    };
  },

  /* 应用内文本输入浮层（原生 prompt 在手机上样式不受控） */
  _promptText({ title, placeholder }){
    return new Promise(resolve => {
      const scr = document.querySelector('.screen') || document.body;
      const o = document.createElement('div');
      o.className = 'picker-overlay';
      o.innerHTML = `
        <div class="picker-sheet">
          <div class="picker-hd">
            <span>${Phone.escapeHtml(title || '输入')}</span>
            <button class="pk-cancel">取消</button>
          </div>
          <div style="padding:4px 14px 16px">
            <textarea class="imp-paste-box" rows="9"
              placeholder="${Phone.escapeHtml(placeholder || '')}"></textarea>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn" id="imp-paste-ok">解析</button>
            </div>
          </div>
        </div>`;
      scr.appendChild(o);
      void o.offsetHeight;
      requestAnimationFrame(()=>requestAnimationFrame(()=>o.classList.add('show')));
      const ta = o.querySelector('.imp-paste-box');
      setTimeout(()=>ta.focus(), 320);

      let done = false;
      const finish = v => { if (done) return; done = true; o.classList.remove('show'); setTimeout(()=>o.remove(),320); resolve(v); };
      o.querySelector('.pk-cancel').onclick = ()=>finish(null);
      o.querySelector('#imp-paste-ok').onclick = ()=>finish(ta.value);
      o.addEventListener('click', e => { if (e.target === o) finish(null); });
    });
  },

  _impError(msg){
    const box = document.getElementById('imp-result');
    if (box) box.innerHTML = `<div class="imp-err">${w.Icons.svg('warn',16)}${Phone.escapeHtml(msg)}</div>`;
    Phone.toast('导入失败');
  },

  /* 展示解析结果，让用户确认再落库 */
  _showImportPlan(plan){
    const box = document.getElementById('imp-result');
    if (!box) return;
    Settings._impPlan = plan;
    const st = plan.stats;
    const c = plan.char;
    const fmtDay = ts => ts ? new Date(ts).toLocaleDateString('zh-CN') : '—';

    box.innerHTML = `
      <div class="imp-card" style="--c1:${c.c1};--c2:${c.c2}">
        <div class="imp-head">
          <div class="imp-av" id="imp-av">${Phone.escapeHtml(c.avatar)}</div>
          <div style="flex:1;min-width:0">
            ${plan.nameGuessed
              ? `<input class="imp-namein" id="imp-name" value="" placeholder="他叫什么？填个名字">`
              : `<div class="imp-name">${Phone.escapeHtml(c.name)}</div>`}
            <div class="imp-sub">${Phone.escapeHtml(c.tag)}</div>
          </div>
        </div>
        <div class="imp-grid">
          <div><b>${st.messages}</b><span>条聊天记录</span></div>
          <div><b>${st.days}</b><span>天跨度</span></div>
          <div><b>${st.facts}</b><span>件长期记忆</span></div>
        </div>
        <div class="imp-desc">
          ${st.settingLen ? '人设设定已读取。' : '<span style="color:var(--warn)">没读到人设，将用默认性格。</span>'}
          记录 ${fmtDay(st.firstAt)} ~ ${fmtDay(st.lastAt)}，
          我发 ${st.mine} 条 / 他发 ${st.ta} 条。
        </div>
        ${plan.mem.summary ? `<details class="imp-mem"><summary>他会记住这些</summary><pre>${Phone.escapeHtml(plan.mem.summary)}</pre>${plan.mem.facts.length?`<div class="imp-facts">${plan.mem.facts.map(f=>`<span>${Phone.escapeHtml(f)}</span>`).join('')}</div>`:''}</details>` : ''}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn" id="imp-ok">${w.Icons.svg('check', 16)}<span>确认导入</span></button>
          <button class="btn ghost" id="imp-cancel">取消</button>
        </div>
      </div>`;

    /* 名字是猜的 → 输入时同步头像首字 */
    const nameIn = box.querySelector('#imp-name');
    if (nameIn){
      nameIn.oninput = ()=>{
        const v = nameIn.value.trim();
        const av = document.getElementById('imp-av');
        if (av) av.textContent = (v[0] || '他');
      };
      setTimeout(()=>nameIn.focus(), 80);
    }

    box.querySelector('#imp-cancel').onclick = ()=>{ Settings._impPlan = null; box.innerHTML=''; };
    box.querySelector('#imp-ok').onclick = ()=> Settings._commitImport();
  },

  async _commitImport(){
    const plan = Settings._impPlan;
    if (!plan) return;

    /* 名字是猜的：用用户填的，没填就用「他」 */
    if (plan.nameGuessed){
      const inp = document.getElementById('imp-name');
      const v = inp ? inp.value.trim() : '';
      if (v){
        plan.char.name = v.slice(0, 12);
        plan.char.avatar = v[0];
      } else {
        Phone.toast('先给他起个名字'); 
        if (inp) inp.focus();
        return;
      }
    }

    const exists = (Phone.S.customCards || []).some(x => x.name === plan.char.name);
    let mode = 'new';
    if (exists){
      const pick = await UI.pick({
        title: `已有一个「${plan.char.name}」`,
        value: 'merge',
        items: [
          { value:'merge', label:'续存到原来那个', desc:'人设更新，聊天记录接着往下接' },
          { value:'new',   label:'作为新角色导入', desc:'另建一个同名的他，互不影响' }
        ]
      });
      mode = pick || 'merge';
    }
    const r = Importer.commit(plan, { mode });
    Settings._impPlan = null;
    Phone.renderHome();
    Settings.render();
    Phone.toast(`已导入 ${r.name} · ${r.count} 条记录`);
    setTimeout(()=>{ Apps.open('chat'); Chat.open(r.id); }, 300);
  }
};

/* ================= App 注册表 ================= */
const APPS = [
  { id:'chat',     name:'聊天',   ico:'chat',     tone:'blue'   , badge: ()=> Phone.unreadTotal() || '' },
  { id:'contacts', name:'通讯录', ico:'contacts', tone:'green'  },
  { id:'moments',  name:'动态',   ico:'grid',     tone:'violet' },
  { id:'chars',    name:'角色',   ico:'mask',     tone:'pink'   },
  { id:'music',    name:'音乐',   ico:'music',    tone:'slate'  },
  { id:'notes',    name:'日记',   ico:'bookmark', tone:'blue'   },
  { id:'gallery',  name:'相册',   ico:'gallery',  tone:'violet' },
  { id:'calls',    name:'通话',   ico:'call',     tone:'pink'   },
  { id:'memory',   name:'记忆',   ico:'heart',    tone:'pink'   },
  { id:'settings', name:'设置',   ico:'settings', tone:'slate'  }
];

/* 应用标题映射 */
const APP_TITLES = {
  chat:'聊天', contacts:'通讯录', moments:'动态', chars:'角色',
  music:'音乐', notes:'他的日记',
  gallery:'相册', calls:'通话记录', memory:'记忆', settings:'设置',
  play:'玩法说明', maker:'制作人'
};

/* 挂到全局，phone.js 渲染桌面时需要（它在前面加载） */
window.APPS = APPS;
window.APP_TITLES = APP_TITLES;

const Apps = {
  open(id){
    const title = APP_TITLES[id] || '聊天';
    document.getElementById('app-title').textContent = title;
    document.getElementById('app-right').innerHTML = '';
    if (window.Phone && Phone.hideHomeFor) Phone.hideHomeFor();
    document.getElementById('appview').classList.add('active');
    document.getElementById('app-body').scrollTop = 0;
    if (id === 'chat') Chat.renderList();
    else if (id === 'calls') Calls.render();
    else if (id === 'gallery') Gallery.render();
    else if (id === 'notes') Notes.render();
    else if (id === 'settings') Settings.render();
    else if (id === 'contacts') Contacts.render();
    else if (id === 'moments') Moments.render();
    else if (id === 'chars') Chars.render();
    else if (id === 'music') Music.render();
    else if (id === 'memory') Memory.render();
    else if (id === 'play') Play.render();
    else if (id === 'maker') Maker.render();
    /* 打开了应用 → 系统状态栏让位给应用标题栏（否则两层会叠在一起） */
    document.body.classList.add('in-app');
    Phone.haptic(10);
  },
  close(){
    document.getElementById('appview').classList.remove('active');
    document.body.classList.remove('in-app');
    if (window.Phone && Phone.showHome) Phone.showHome();
    Chat.close();
    Phone.renderHome();
  }
};

/* ================================================================
   以下为参考图新增应用
   ================================================================ */
const I = () => w.Icons;

/* ---------------- 通讯录 ---------------- */
const Contacts = {
  render(){
    const body = document.getElementById('app-body');
    const all = Phone.allChars();
    let html = '<div class="ct-wrap">';
    all.forEach(c => {
      const talks = Phone.talkCount(c.id);
      html += `
        <div class="ct-item" data-c="${c.id}">
          ${Phone.avatarHTML(c, { size:46, cls:'ct-av', radius:15 })}
          <div class="ct-mid">
            <div class="ct-nm">${Phone.escapeHtml(c.name)}
              <span class="ct-tag">${Phone.escapeHtml(c.tag || '')}</span>
            </div>
            <div class="ct-sub">${talks > 0 ? '聊了 ' + talks + ' 句' : '还没聊过'}</div>
          </div>
          <div class="ct-act">
            <button class="icon-btn" data-msg="${c.id}" title="发消息">${I().svg('chat', 19)}</button>
            <button class="icon-btn" data-call="${c.id}" title="打电话">${I().svg('call', 19)}</button>
          </div>
        </div>`;
    });
    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('[data-msg]').forEach(b => {
      b.onclick = e => { e.stopPropagation(); Apps.open('chat'); Chat.open(b.dataset.msg); };
    });
    body.querySelectorAll('[data-call]').forEach(b => {
      b.onclick = e => { e.stopPropagation(); Call.start(b.dataset.call); };
    });
    body.querySelectorAll('.ct-item').forEach(el => {
      el.onclick = () => { Apps.open('chat'); Chat.open(el.dataset.c); };
    });
  }
};

/* ---------------- 动态（他发的心情） ---------------- */
const Moments = {
  render(){
    const body = document.getElementById('app-body');
    const all = Phone.allChars();
    let feeds = [];
    all.forEach(c => {
      const talks = Phone.talkCount(c.id);
      (c.moments || []).forEach(m => {
        if (talks >= (m.at || 0)) feeds.push({ c, m });
      });
    });
    feeds.sort((a, b) => (b.m.at || 0) - (a.m.at || 0));

    let html = '<div class="mo-wrap">';
    if (!feeds.length){
      html += `<div class="empty-tip"><span class="big ico-big">${I().svg('grid', 40)}</span>
        还没有动态<br>多和他聊聊，他就会发</div>`;
    } else {
      feeds.forEach(({ c, m }) => {
        html += `
          <div class="card mo-card">
            <div class="mo-hd">
              ${Phone.avatarHTML(c, { size:42, cls:'mo-av', radius:14 })}
              <div class="mo-id">
                <div class="mo-nm">${Phone.escapeHtml(c.name)}</div>
                <div class="mo-tm">${Phone.escapeHtml(m.time || '刚刚')}</div>
              </div>
            </div>
            <div class="mo-txt">${Phone.escapeHtml(m.text)}</div>
            <div class="mo-ft">
              <button class="mo-like" data-like>${I().svg('heart', 16)}<span>${m.likes || 0}</span></button>
              <span class="mo-cmt">${Phone.escapeHtml(m.cmt || '')}</span>
            </div>
          </div>`;
      });
    }
    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('[data-like]').forEach(b => {
      b.onclick = () => {
        const n = b.querySelector('span');
        const liked = b.classList.toggle('on');
        n.textContent = (+n.textContent) + (liked ? 1 : -1);
        Phone.haptic(8);
      };
    });
  }
};

/* ---------------- 角色 ---------------- */
const Chars = {
  render(){
    const body = document.getElementById('app-body');
    const all = Phone.allChars();
    const cur = Phone.S.activeChar;
    let html = '<div class="ch-wrap">';
    all.forEach(c => {
      const talks = Phone.talkCount(c.id);
      const persona = Engine.hasPersona(c);
      html += `
        <div class="card ch-card ${c.id === cur ? 'on' : ''}" data-c="${c.id}">
          ${Phone.avatarHTML(c, { size:54, cls:'ch-av', radius:18 })}
          <div class="ch-mid">
            <div class="ch-nm">${Phone.escapeHtml(c.name)} ${c.id === cur ? '<span class="ch-cur">使用中</span>' : ''}</div>
            <div class="ch-tag">${Phone.escapeHtml(c.tag || '')} · ${persona ? '扮演中' : '普通 AI'}</div>
            <div class="ch-bar"><i style="width:${Math.min(100, talks)}%"></i></div>
            <div class="ch-sub">聊了 ${talks} 句${persona ? ' · 他会按人设回答' : ' · 普通 AI 对话'}</div>
          </div>
        </div>`;
    });
    html += `<div class="btn-row" style="padding:0 2px">
      <button class="btn" id="ch-new">${I().svg('plus', 17)}<span>自己捏一个</span></button>
    </div></div>`;
    body.innerHTML = html;

    body.querySelectorAll('.ch-card').forEach(el => {
      el.onclick = () => {
        Phone.S.activeChar = el.dataset.c;
        Phone.save();
        Phone.renderHome();
        Chars.render();
        Phone.toast('已切换到 ' + Phone.char(el.dataset.c).name);
        Phone.haptic(12);
      };
    });
    const nb = document.getElementById('ch-new');
    if (nb) nb.onclick = () => { Apps.open('settings'); setTimeout(()=>{
      const btn = document.getElementById('card-new'); if (btn) btn.click();
    }, 60); };
  }
};

/* ---------------- 音乐播放器 ---------------- */
const Music = {
  list: [
    { t: '我的女人', a: '小贱', d: 255 },
    { t: '想你的夜', a: '关喆', d: 268 },
    { t: '夜空中最亮的星', a: '逃跑计划', d: 252 },
    { t: '像风一样', a: '薛之谦', d: 250 },
    { t: '如果有一天', a: '梁静茹', d: 231 }
  ],
  cur: 0, playing: false, pos: 0, timer: null,
  render(){
    const body = document.getElementById('app-body');
    const it = this.list[this.cur];
    body.innerHTML = `
      <div class="mu-wrap">
        <div class="card mu-cover" id="mu-cover">
          <div class="mu-disc ${this.playing ? 'spin' : ''}" id="mu-disc">${I().svg('music', 46)}</div>
        </div>
        <div class="mu-title" id="mu-title">${Phone.escapeHtml(it.t)}</div>
        <div class="mu-artist" id="mu-artist">${Phone.escapeHtml(it.a)}</div>

        <div class="mu-prog">
          <div class="mu-bar" id="mu-bar"><i id="mu-fill" style="width:0%"></i></div>
          <div class="mu-time"><span id="mu-now">0:00</span><span id="mu-end">${Music.fmt(it.d)}</span></div>
        </div>

        <div class="mu-ctrl">
          <button class="mu-btn" id="mu-prev">${I().svg('prev', 22)}</button>
          <button class="mu-btn main" id="mu-play">${I().svg(Music.playing ? 'pause' : 'play', 26)}</button>
          <button class="mu-btn" id="mu-next">${I().svg('next', 22)}</button>
        </div>

        <div class="mu-list">
          ${this.list.map((s, i) => `
            <div class="mu-row ${i === this.cur ? 'on' : ''}" data-i="${i}">
              <span class="mu-no">${i + 1}</span>
              <span class="mu-nm">${Phone.escapeHtml(s.t)}</span>
              <span class="mu-ar">${Phone.escapeHtml(s.a)}</span>
            </div>`).join('')}
        </div>
      </div>`;

    document.getElementById('mu-prev').onclick = () => Music.prev();
    document.getElementById('mu-next').onclick = () => Music.next();
    document.getElementById('mu-play').onclick = () => Music.toggle();
    body.querySelectorAll('.mu-row').forEach(r => {
      r.onclick = () => { Music.cur = +r.dataset.i; Music.pos = 0; Music.playing = true; Music.render(); Music.tick(); };
    });
    document.getElementById('mu-bar').onclick = e => {
      const r = e.currentTarget.getBoundingClientRect();
      Music.pos = Math.round((e.clientX - r.left) / r.width * Music.list[Music.cur].d);
      Music.tick();
    };
    if (Music.playing) Music.tick();
  },
  fmt(s){ return Math.floor(s / 60) + ':' + Phone.pad(s % 60); },
  toggle(){
    Music.playing = !Music.playing;
    if (Music.playing){ Music.tick(); Phone.blurp && Phone.blurp(); }
    else clearInterval(Music.timer);
    Music.render();
  },
  prev(){ Music.cur = (Music.cur - 1 + Music.list.length) % Music.list.length; Music.pos = 0; Music.render(); },
  next(){ Music.cur = (Music.cur + 1) % Music.list.length; Music.pos = 0; Music.render(); },
  tick(){
    clearInterval(Music.timer);
    const fill = document.getElementById('mu-fill');
    const now = document.getElementById('mu-now');
    const disc = document.getElementById('mu-disc');
    if (disc) disc.classList.add('spin');
    Music.timer = setInterval(() => {
      const d = Music.list[Music.cur].d;
      Music.pos = Math.min(Music.pos + 1, d);
      const f = document.getElementById('mu-fill');
      const n = document.getElementById('mu-now');
      if (!f || !n){ clearInterval(Music.timer); return; }
      f.style.width = (Music.pos / d * 100) + '%';
      n.textContent = Music.fmt(Music.pos);
      if (Music.pos >= d) Music.next();
    }, 1000);
  }
};

/* ---------------- 记忆 ---------------- */
const Memory = {
  render(){
    const body = document.getElementById('app-body');
    const c = Phone.cur();
    const mem = Engine.recall ? Engine.recall(c.id) : null;
    const facts = (mem && mem.facts) || [];
    const s = Phone.st(c.id);
    let html = '<div class="me-wrap">';
    html += `
      <div class="card me-hd">
        ${Phone.avatarHTML(c, { size:50, cls:'me-av', radius:17 })}
        <div>
          <div class="me-nm">${Phone.escapeHtml(c.name)}还记得</div>
          <div class="me-sub">${facts.length} 条关于你的事 · ${Math.max(s.turns || 0, ((mem && mem.summarized) || 0))} 轮对话</div>
        </div>
      </div>`;

    /* 长期摘要：聊久了自动滚动总结出来的"你们的相处经历" */
    const summary = (mem && mem.summary) || '';
    if (summary){
      html += `
        <div class="card me-sum">
          <div class="me-sum-h">${I().svg('bookmark', 16)}<span>他记得的相处经历</span></div>
          <div class="me-sum-t">${Phone.escapeHtml(summary).replace(/\n/g,'<br>')}</div>
        </div>`;
    }

    if (!facts.length && !summary){
      html += `<div class="empty-tip"><span class="big ico-big">${I().svg('heart', 40)}</span>
        他还没记住什么<br>多聊聊你的生活，他会记下来</div>`;
    } else if (facts.length){
      html += '<div class="me-list">';
      facts.forEach((f, i) => {
        const t = typeof f === 'string' ? f : (f.t || f.text || '');
        const keys = (f && f.keys) || [];
        html += `
          <div class="card me-item">
            <span class="me-no">${i + 1}</span>
            <span class="me-txt">${Phone.escapeHtml(t)}
              ${keys.length ? `<span class="me-keys">${keys.slice(0,3).map(k=>`<i>${Phone.escapeHtml(k)}</i>`).join('')}</span>` : ''}
            </span>
            <button class="me-del" data-del="${i}" title="忘记">${I().svg('close', 15)}</button>
          </div>`;
      });
      html += '</div>';
    }
    if (facts.length || summary){
      html += `<div class="btn-row" style="padding:0 2px">
        <button class="btn danger" id="me-clear">${I().svg('trash', 17)}<span>让他全部忘掉</span></button>
      </div>`;
    }
    html += '</div>';
    body.innerHTML = html;

    body.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => {
        Engine.forget && Engine.forget(Phone.S.activeChar, +b.dataset.del);
        Phone.toast('忘掉了这一条');
        Memory.render();
      };
    });
    const cl = document.getElementById('me-clear');
    if (cl) cl.onclick = async () => {
      const ok = await UI.confirm({
        title:'让他忘记', danger:true,
        text:'让他把所有关于你的事都忘掉？',
        okText:'忘掉', cancelText:'算了'
      });
      if (!ok) return;
      Engine.forgetAll && Engine.forgetAll(Phone.S.activeChar);
      Phone.toast('他什么都不记得了');
      Memory.render();
    };
  }
};

/* ---------------- 玩法说明 ---------------- */
const Play = {
  render(){
    const body = document.getElementById('app-body');
    const rules = [
      { ico:'chat',   t:'和他聊天',     d:'点桌面「聊天」，随便说什么。他会记得你说过的话。' },
      { ico:'mask',   t:'自己扮演调教', d:'你写的人设决定他是什么样。想让他变，就改设定或直接在对话里教他。' },
      { ico:'gallery',t:'相册',           d:'相册里放的是你自己上传的照片，随时可以增删。' },
      { ico:'call',   t:'给他打电话',   d:'聊天页右上角点通话，他会接，还能听到他说话。' },
      { ico:'palette',t:'换聊天背景',   d:'聊天页右上角调色盘，9 种背景，也能传自己的图。' },
      { ico:'user',   t:'换头像',       d:'设置→头像：你和他的都能换成图片，比文字更有感觉。' },
      { ico:'gallery',t:'换壁纸',       d:'设置→壁纸：锁屏和桌面可以各用一张。' },
      { ico:'camera', t:'摄像头',       d:'他会申请看你一眼；每次都要你点「允许一次」，不同意绝不会开。' },
      { ico:'zap',    t:'接入在线模型', d:'设置里填 API，他会变得更聪明（不填也能玩）。' },
      { ico:'mask',   t:'换角色 / 自捏', d:'桌面「角色」里切换，也能自己写一个新的人设。' },
      { ico:'moon',   t:'锁屏',         d:'点底部 Home 条锁屏，上滑或点一下解锁。' }
    ];
    body.innerHTML = `
      <div class="pl-wrap">
        <div class="card pl-hd">
          <div class="pl-h">怎么玩</div>
          <div class="pl-d">这台小手机里住着几个喜欢你的人。<br>你越常来，他们越离不开你。</div>
        </div>
        ${rules.map(r => `
          <div class="card pl-item">
            <div class="pl-ico">${I().svg(r.ico, 21)}</div>
            <div class="pl-mid">
              <div class="pl-t">${r.t}</div>
              <div class="pl-x">${r.d}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }
};

/* ---------------- 制作人 ---------------- */
const Maker = {
  render(){
    const body = document.getElementById('app-body');
    body.innerHTML = `
      <div class="card mk-wrap">
        <div class="mk-av">${I().svg('cat', 42)}</div>
        <div class="mk-nm">Amor</div>
        <div class="mk-sub">小手机 · 人机恋模拟</div>
        <div class="mk-line"></div>
        <div class="mk-txt">
          这台小手机是一个可以在浏览器里跑的小玩具。<br>
          所有聊天记录、背景都只存在你自己的设备上，不上传任何服务器。<br>
          不接 API 也能玩，接了 API 他会更聪明。
        </div>
        <div class="mk-ver">v1.0 · 本地运行 · 零依赖</div>
        <div class="btn-row" style="justify-content:center;margin-top:4px">
          <button class="btn ghost" id="mk-play">${I().svg('play', 17)}<span>看看怎么玩</span></button>
        </div>
      </div>
      <div class="card mk-wrap" style="margin-top:12px">
        <div class="mk-h">鸣谢</div>
        <div class="mk-txt">
          角色：薛沉 / 林砚 / 祁野<br>
          引擎：内置人格引擎 + OpenAI 兼容接口<br>
          图标：自制 SVG 线稿图标集
        </div>
      </div>`;
    const pb = document.getElementById('mk-play');
    if (pb) pb.onclick = () => Apps.open('play');
  }
};
