/* =========================================================
   小手机 · 回复引擎
   1) 优先走「在线模型」（在【设置】里填 Key 即可）
   2) 没有 Key 时，用内置的本地人格引擎顶班：同样有情绪、记忆、节奏
   ========================================================= */

const Engine = (() => {

  /* ---------- 全局配置 ---------- */
  const CFG_KEY = 'xmj.cfg.v1';
  let cfg = {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    protocol: 'openai',    // openai | anthropic | gemini | ollama | custom
    onlineMode: 'auto',   // auto | always | never
    temperature: 1.0,
    maxTokens: 300,
    contextLimit: 0       // 模型上下文窗口（tokens）。0 = 自动按模型名猜
  };

  function loadCfg(){
    try{
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
    }catch(e){}
    return cfg;
  }
  function saveCfg(patch){
    Object.assign(cfg, patch||{});
    try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){}
    return cfg;
  }
  function getCfg(){ return cfg; }
  function hasKey(){ return !!(cfg.apiKey && cfg.apiKey.trim()); }
  loadCfg();

  /* ---------- 记忆相关的容量上限（集中在这里，方便调整） ----------
     SUMMARY_MAX   滚动摘要最多存多少字（越大记得越细，也越占 prompt token）
     SUM_BATCH     攒够多少条消息就触发一次总结
     HISTORY_WINDOW 最近多少条原文进 prompt（比这更早的靠摘要兜底）
     FACT_MAX      每个角色最多记多少条长期事实
     MSG_MAX       每个角色最多保留多少条消息（存储层，超了滚掉最老的） */
  const SUMMARY_MAX = 1600;
  const SUM_BATCH = 24;
  const HISTORY_WINDOW = 40;
  const FACT_MAX = 30;
  const MSG_MAX = 800;

  /* ---------- 记忆 ---------- */
  const MEM_KEY = 'xmj.mem.v1';
  function loadMem(){
    try{ return JSON.parse(localStorage.getItem(MEM_KEY)) || {}; }catch(e){ return {}; }
  }
  let MEM = loadMem();
  function saveMem(){ try{ localStorage.setItem(MEM_KEY, JSON.stringify(MEM)); }catch(e){} }

  /* 按 id 找角色对象（CHARS 定义在 characters.js，是全局 const 对象） */
  function charById(id){
    try{
      if (typeof CHARS !== 'undefined' && CHARS){
        if (CHARS[id]) return CHARS[id];
        const hit = Object.values(CHARS).find(c => c && c.id === id);
        if (hit) return hit;
      }
    }catch(e){}
    return { id: id, name: '他' };
  }

  function recall(charId){
    if (!MEM[charId]) MEM[charId] = { facts: [], turns: 0, mood: 0, summary: '' };
    const m = MEM[charId];
    if (!Array.isArray(m.facts)) m.facts = [];
    if (typeof m.turns !== 'number') m.turns = 0;
    if (typeof m.mood !== 'number') m.mood = 0;
    if (typeof m.summary !== 'string') m.summary = '';
    /* 滚动摘要用的游标：summarized 是"已经总结进 summary 的消息条数"，
       facts 升级后是对象数组 { t:文本, keys:[关键词] }，兼容老的纯字符串 */
    if (typeof m.summarized !== 'number') m.summarized = 0;
    m.facts = m.facts.map(f => typeof f === 'string' ? { t: f, keys: autoKeys(f) } : f);
    return m;
  }

  /* 给一条记忆自动提关键词（老数据升级 / 未手填时用） */
  function autoKeys(text){
    const s = String(text || '');
    const out = [];
    /* 抽关键词：连续汉字 2-6 字，或连续英文/数字 2-6 字，
       两者不混（避免「橘猫undefined」被切出「橘猫unde」这种垃圾词）；
       英文必须是独立词（两侧不能再是字母/数字），否则一律丢弃 */
    const core = s.replace(/^(喜欢|不喜欢|讨厌|名字：|身份：|养了|住在|最近在|明天要|后天要|下周要)/, '')
                    .replace(/^(和|跟|还有|以及|的)/, '');
    const re = /[\u4e00-\u9fa5]{2,6}|(?<![A-Za-z0-9])[A-Za-z0-9]{2,6}(?![A-Za-z0-9])/g;
    let m;
    while ((m = re.exec(core))){
      out.push(m[0]);
      if (out.length >= 5) break;
    }
    return out;
  }

  /* 导入人设/聊天记录时用：把「以前的记忆」直接种进去，
     让在线模型一上来就知道你们之前聊过什么（续存人设）。 */
  function seedMem(charId, seed){
    const m = recall(charId);
    seed = seed || {};
    if (Array.isArray(seed.facts)){
      seed.facts.forEach(f => {
        const t = typeof f === 'string' ? f : (f && f.t);
        if (!t || m.facts.some(x => x.t === t)) return;
        m.facts.push({ t: String(t).slice(0, 60), keys: (f && f.keys) || autoKeys(t) });
      });
    }
    if (typeof seed.mood === 'number') m.mood = Math.max(-10, Math.min(10, seed.mood));
    if (typeof seed.turns === 'number') m.turns = Math.max(m.turns, seed.turns);
    if (typeof seed.summary === 'string' && seed.summary.trim()) m.summary = seed.summary.trim().slice(0, 1200);
    /* 导入了历史记录 → 这些已经"算进摘要"，游标得跟上，
       否则下一轮滚动摘要会把这些陈年旧账又总结一遍 */
    if (typeof seed.summarized === 'number') m.summarized = Math.max(m.summarized, seed.summarized);
    else if (Array.isArray(seed.facts) && seed.summary) m.summarized = Math.max(m.summarized, 0);
    if (m.facts.length > FACT_MAX) m.facts = m.facts.slice(-FACT_MAX);
    saveMem();
    return m;
  }
  function getSummary(charId){ return recall(charId).summary || ''; }
  function clearMem(charId){
    const m = recall(charId);
    m.facts = []; m.turns = 0; m.summary = ''; m.summarized = 0;
    saveMem();
  }

  /* 从用户话里提炼可以长期记住的事 */
  const FACT_RULES = [
    { re: /我(喜欢|爱)(吃|喝)?([\u4e00-\u9fa5A-Za-z0-9]{2,6})/, f: m => `喜欢${m[3]}` },
    { re: /我(不喜欢|讨厌|不爱)(吃|喝)?([\u4e00-\u9fa5A-Za-z0-9]{2,6})/, f: m => `不喜欢${m[3]}` },
    { re: /我(会|要|想)?(去|在)(上班|下课|上课|睡觉|加班|出差|旅游|医院)/, f: m => `最近在${m[2]}${m[3]}` },
    { re: /我(是|做)([\u4e00-\u9fa5A-Za-z]{2,8})(的)?/, f: m => `身份：${m[2]}` },
    { re: /我(养|有)了?(一?只|一条|一个)([\u4e00-\u9fa5]{1,4})/, f: m => `养了${m[3]}` },
    { re: /我叫([\u4e00-\u9fa5A-Za-z0-9]{1,8})/, f: m => `名字：${m[1]}` },
    { re: /我(住在|家在)([\u4e00-\u9fa5]{2,8})/, f: m => `住在${m[2]}` },
    { re: /我(明天|后天|下周)([\u4e00-\u9fa5]{2,10})/, f: m => `${m[1]}要${m[2]}` }
  ];

  function extractFact(text){
    for (const r of FACT_RULES){
      const m = text.match(r.re);
      if (m){
        const f = r.f(m);
        /* 过滤：太短（<3字，如"喜欢第"）或太长的都丢弃 */
        if (f && f.length >= 3 && f.length < 22) return f;
      }
    }
    return null;
  }

  function remember(charId, text){
    const m = recall(charId);
    m.turns++;
    const f = extractFact(text);
    /* facts 现在是 { t, keys } 对象数组，同内容不重复记 */
    if (f && !m.facts.some(x => x.t === f)){
      m.facts.push({ t: f, keys: autoKeys(f) });
      if (m.facts.length > FACT_MAX) m.facts.shift();
      saveMem();
      return f;
    }
    saveMem();
    return null;
  }

  /* ---------- 情绪 ---------- */
  function touchMood(charId, delta){
    const m = recall(charId);
    m.mood = Math.max(-10, Math.min(10, m.mood + delta));
    saveMem();
    return m.mood;
  }
  function moodOf(charId){ return recall(charId).mood; }

  /* =========================================================
     滚动摘要（Recursive Summarization）
     ---------------------------------------------------------
     问题：上下文窗口有限，不可能把几百轮对话全喂给模型，
          只取最近 16 条会让 AI 忘记更早发生的事。
     做法：把"已经在摘要游标之前"的旧消息，定期交给模型压缩成
          一段「之前发生了什么」，合并进 m.summary。
          摘要会一直挂在 system prompt 里 → 聊多久都不失忆。

     关键设计：
       - summarized 游标：记录"已经被总结进 summary 的消息条数"，
         只总结游标之后、窗口之前的"中间那段"，不重复总结。
       - 本地兜底：没有 API key 时用规则抽句子，聊胜于无。
       - 摘要长度上限 SUMMARY_MAX，超了就再压一次（递归）。
     ========================================================= */

  /* 把消息数组转成便于阅读的对话文本 */
  function msgsToText(msgs, charName){
    return msgs.map(m => {
      const who = m.from === 'me' ? '对方' : (charName || '他');
      const body = m.t === 'voice' ? ('[语音] ' + (m.text || '')) : String(m.v || '');
      return `${who}：${body}`;
    }).filter(l => l.length > 3).join('\n');
  }

  /* 本地兜底摘要：没 key 时用，挑信息量大的句子 */
  function localSummarize(text, max){
    const lines = text.split('\n').filter(Boolean);
    /* 优先保留带"事件/偏好"特征的句子 */
    const key = /(喜欢|讨厌|养|猫|狗|工作|加班|出差|考试|生日|家|妈妈|爸爸|朋友|难过|开心|分手|吵架|答应|约定|名字|住|吃)/;
    const picked = lines.filter(l => key.test(l)).slice(-14);
    const rest = lines.slice(-6);
    const all = [...new Set([...picked, ...rest])];
    let out = all.join('\n');
    if (out.length > max){
      /* 按行裁剪，避免把一条消息切成半句 */
      const keep = [];
      for (let i = all.length - 1; i >= 0; i--){
        keep.unshift(all[i]);
        if (keep.join('\n').length > max){ keep.shift(); break; }
      }
      out = keep.join('\n');
      if (out.length > max) out = out.slice(-max);
    }
    return out;
  }

  /* 用模型把旧消息压成摘要；失败/无 key 就本地兜底 */
  async function summarize(oldText, prevSummary, char){
    const sys = `你是一个记忆整理助手。请把下面的聊天记录压缩成一段简洁的第三人称回忆，用于让角色记住你们之间发生过什么。
要求：
- 用"对方"指代用户，用角色名指代他自己
- 只保留有长期价值的信息：身份、偏好、重要事件、关系进展、约定、称呼、情绪转折
- 丢掉寒暄、重复、无关紧要的细节
- 保持时间顺序，控制在 200 字以内
- 直接输出回忆正文，不要任何解释或标题`;

    const userMsg = (prevSummary ? `【之前已经记住的】\n${prevSummary}\n\n` : '')
      + `【新增的聊天记录】\n${oldText}`;

    if (hasKey() && cfg.onlineMode !== 'never'){
      try{
        const p = proto();
        const msgs = p.buildMessages(sys, [], userMsg);
        const u = apiUrls(cfg.baseUrl);
        const body = Object.assign(
          p.buildBody(cfg.model, msgs, { temperature: 0.3, maxTokens: 400 }),
          {}
        );
        const res = await fetch(u.chat, {
          method: 'POST',
          headers: p.headers(cfg.apiKey.trim(), u.chat),
          body: JSON.stringify(body)
        });
        if (res.ok){
          const raw = await res.text();
          let data = null;
          try{ data = JSON.parse(raw); }catch(e){}
          let out = data ? String(p.parse(data) || '').trim() : '';
          if (out) return out.slice(0, SUMMARY_MAX);
        }
      }catch(e){ /* 落到本地兜底 */ }
    }
    return localSummarize(userMsg, SUMMARY_MAX);
  }

  /* 主入口：检查是否需要滚动总结，需要就做了。
     msgs 是当前完整消息数组（由 Chat 传进来），异步，别 await 阻塞回复。 */
  let summarizing = false;
  async function maybeSummarize(charId, msgs){
    if (summarizing) return null;
    if (!Array.isArray(msgs) || msgs.length < HISTORY_WINDOW + SUM_BATCH) return null;
    const m = recall(charId);
    const cut = msgs.length - HISTORY_WINDOW;   /* 窗口之前的算"旧消息" */
    if (cut - m.summarized < SUM_BATCH) return null;   /* 攒得还不够 */

    const oldSlice = msgs.slice(m.summarized, cut);
    if (!oldSlice.length) return null;

    summarizing = true;
    try{
      const who = charById(charId);
      const text = msgsToText(oldSlice, who.name);
      const next = await summarize(text, m.summary, who);
      if (next){
        m.summary = next.slice(-SUMMARY_MAX);
        m.summarized = cut;
        saveMem();
        /* 顺手把这段里值得长期记的事也抽出来 */
        oldSlice.forEach(x => { if (x.from === 'me') rememberQuiet(charId, x.v || ''); });
        return m.summary;
      }
    } finally {
      summarizing = false;
    }
    return null;
  }

  /* 只抽事实、不涨回合数（总结旧消息时用，避免重复计数） */
  function rememberQuiet(charId, text){
    const m = recall(charId);
    const f = extractFact(text);
    if (f && !m.facts.some(x => x.t === f)){
      m.facts.push({ t: f, keys: autoKeys(f) });
      if (m.facts.length > FACT_MAX) m.facts.shift();
    }
  }

  /* ---------- 记忆管理（记忆 App 用） ---------- */
  function forget(charId, idx){
    const m = recall(charId);
    if (idx >= 0 && idx < m.facts.length){
      const gone = m.facts.splice(idx, 1)[0];
      saveMem();
      return gone && gone.t || gone;
    }
    return null;
  }
  function forgetAll(charId){
    const m = recall(charId);
    m.facts = [];
    m.turns = 0;
    saveMem();
  }

  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  /* ---------- 分析输入 ---------- */
  function analyze(char, text){
    const t = text || '';
    let mood = 0, reply = null;

    const R = char.react || {};
    for (const key of ['praise','cold','night','food','ask']){
      const r = R[key];
      if (!r) continue;
      if ((r.words||[]).some(w => t.includes(w))){
        mood += r.mood || 0;
        if (!reply && ['praise','cold','night'].includes(key)) reply = pick(r.say || []);
        else if (!reply && Math.random() < .5) reply = pick(r.say || []);
      }
    }

    if (!reply){
      const q = /([?？]|吗|呢|怎么|为什么|哪|谁|什么)/.test(t);
      if (q){
        reply = pick([
          '……你想知道什么。', '嗯，问吧。', '你猜。',
          '这个啊。', '问这么多干嘛。', '你想听我说什么？'
        ]);
      }
    }
    return { mood, reply };
  }

  /* ---------- 本地引擎：生成回复 ----------
     没有在线模型时，不再编造角色台词（那就成了"自动剧情"）。
     这里只诚实地告诉用户：需要联网 / 填 Key 才能对话。 */
  function localReply(char, text){
    if (!char){
      return { t:'text', v:'（还没有角色。去【制作人】里建一个人设，我才能跟你聊天。）' };
    }
    if (!hasPersona(char)){
      return {
        t:'text',
        v:'（现在还没连上在线模型，我暂时没法正常回答。到【设置】里填一下 API，我就能像普通 AI 那样跟你对话了。）'
      };
    }
    return {
      t:'text',
      v:'（还没连上在线模型，所以' + (char.name || '他') + '现在说不了话。到【设置】里填一下 API 就好了。）'
    };
  }


  /* ---------- 多协议适配 ----------
     不同服务商的接口格式只有四点差异：地址、请求体、鉴权头、响应解析。
     这里把差异集中成一张表，上层 onlineReply 只管"要哪些消息、要什么模型"。 */

  const PROTOCOLS = {
    /* OpenAI 兼容：DeepSeek / Kimi / 智谱 / 通义 / OpenRouter / 硅基流动 / 绝大多数中转站 */
    openai: {
      label: 'OpenAI 兼容',
      hint: 'DeepSeek、Kimi、智谱、通义、OpenRouter、各类中转站',
      keyPlaceholder: 'sk-...',
      buildUrl(root, model){
        return { chat: root + '/chat/completions', models: root + '/models' };
      },
      headers(key){ return { 'Content-Type':'application/json', 'Authorization':'Bearer ' + key }; },
      buildBody(model, msgs, c){
        return { model, messages: msgs, temperature: c.temperature, max_tokens: c.maxTokens, stream:false };
      },
      /* 统一把 system 放消息数组里 */
      buildMessages(system, history, text){
        const out = [{ role:'system', content: system }];
        for (const m of history) out.push(m);
        out.push({ role:'user', content: text });
        return out;
      },
      parse(data){
        const c = data && data.choices && data.choices[0];
        if (!c) return '';
        if (c.message && c.message.content != null){
          const ct = c.message.content;
          /* 有些模型返回数组形式的分段内容 */
          if (Array.isArray(ct)) return ct.map(p => (typeof p === 'string' ? p : (p.text || p.content || ''))).join('');
          return String(ct);
        }
        if (c.text) return String(c.text);
        if (c.delta && c.delta.content) return String(c.delta.content);
        return '';
      },
      parseStream(raw){
        return raw.split(/\n/).map(l => l.replace(/^data:\s*/,'').trim())
          .filter(l => l && l !== '[DONE]')
          .map(l => { try{ return PROTOCOLS.openai.parse(JSON.parse(l)); }catch(e){ return ''; } })
          .join('');
      }
    },

    /* Anthropic 原生（Claude）：system 单独顶层字段，用 x-api-key 头 */
    anthropic: {
      label: 'Anthropic 原生',
      hint: 'Claude 官方 api.anthropic.com',
      keyPlaceholder: 'sk-ant-...',
      buildUrl(root, model){
        /* 用户可能填 https://api.anthropic.com 或 .../v1，统一到 /v1/messages */
        const base = root.replace(/\/messages\/*$/i,'').replace(/\/v\d+\/*$/,'');
        return { chat: base + '/v1/messages', models: base + '/v1/models' };
      },
      headers(key){
        return {
          'Content-Type':'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          /* 允许浏览器直连（部分代理会读这个头） */
          'anthropic-dangerous-direct-browser-access': 'true'
        };
      },
      buildBody(model, msgs, c){
        /* msgs 里已剔除 system；Anthropic 把 system 放顶层 */
        const sys = msgs.system || '';
        return {
          model,
          system: sys,
          messages: msgs.list,
          temperature: c.temperature,
          max_tokens: c.maxTokens
        };
      },
      buildMessages(system, history, text){
        /* Anthropic 要求 role 只能是 user / assistant 且交替 */
        const list = [];
        for (const m of history){
          if (!m.content) continue;
          const last = list[list.length-1];
          if (last && last.role === m.role) last.content += '\n' + m.content;
          else list.push({ role:m.role, content:m.content });
        }
        const lastOne = list[list.length-1];
        if (lastOne && lastOne.role === 'user') lastOne.content += '\n' + text;
        else list.push({ role:'user', content:text });
        return { system, list };
      },
      parse(data){
        if (!data) return '';
        if (Array.isArray(data.content))
          return data.content.map(p => (p.type === 'text' ? p.text : '')).join('');
        return data.completion || data.content || '';
      },
      parseStream(raw){
        return raw.split(/\n/).map(l => l.replace(/^data:\s*/,'').trim())
          .filter(Boolean)
          .map(l => { try{ const j = JSON.parse(l);
            if (j.type === 'content_block_delta' && j.delta) return j.delta.text || '';
            if (j.type === 'content_block_start' && j.content_block) return j.content_block.text || '';
            return ''; }catch(e){ return ''; } })
          .join('');
      }
    },

    /* Google Gemini 原生：模型在 URL 里，用 query 传 key */
    gemini: {
      label: 'Google Gemini',
      hint: 'generativelanguage.googleapis.com',
      keyPlaceholder: 'AIza...',
      buildUrl(root, model){
        const base = root.replace(/\/v\d+[a-z]*\/*$/i,'').replace(/\/(models|openai)\/*$/i,'');
        const m = String(model || '').replace(/^models\//,'');
        return {
          chat: base + '/v1beta/models/' + m + ':generateContent',
          models: base + '/v1beta/models'
        };
      },
      headers(key, url){
        /* Gemini 新版也接受 Bearer；同时保留 key 查询参数兼容 */
        return { 'Content-Type':'application/json', 'Authorization':'Bearer ' + key };
      },
      buildBody(model, msgs, c){
        return {
          systemInstruction: msgs.system ? { parts:[{ text: msgs.system }] } : undefined,
          contents: msgs.list,
          generationConfig: { temperature: c.temperature, maxOutputTokens: c.maxTokens }
        };
      },
      buildMessages(system, history, text){
        const list = [];
        for (const m of history){
          if (!m.content) continue;
          list.push({ role: m.role === 'assistant' ? 'model' : 'user', parts:[{ text: m.content }] });
        }
        list.push({ role:'user', parts:[{ text }] });
        return { system, list };
      },
      parse(data){
        if (!data) return '';
        const c = data.candidates && data.candidates[0];
        if (!c) return '';
        if (c.content && Array.isArray(c.content.parts))
          return c.content.parts.map(p => p.text || '').join('');
        if (typeof c.output === 'string') return c.output;
        return '';
      },
      parseStream(raw){
        return raw.split(/\n/).map(l => l.replace(/^data:\s*/,'').trim())
          .filter(l => l && l !== '[DONE]')
          .map(l => { try{ return PROTOCOLS.gemini.parse(JSON.parse(l)); }catch(e){ return ''; } })
          .join('');
      }
    },

    /* 本地 Ollama 原生（非 OpenAI 路径） */
    ollama: {
      label: 'Ollama 原生',
      hint: '本地 http://localhost:11434',
      keyPlaceholder: '（本地通常免填）',
      buildUrl(root){
        const base = root.replace(/\/api\/*$/i,'').replace(/\/v\d+\/*$/i,'');
        return { chat: base + '/api/chat', models: base + '/api/tags' };
      },
      headers(key){ return { 'Content-Type':'application/json' }; },
      buildBody(model, msgs, c){
        return {
          model,
          messages: msgs.list,
          options: { temperature: c.temperature, num_predict: c.maxTokens },
          stream: false
        };
      },
      buildMessages(system, history, text){
        const out = [];
        if (system) out.push({ role:'system', content:system });
        for (const m of history) out.push(m);
        out.push({ role:'user', content:text });
        return { system, list: out };
      },
      parse(data){
        if (!data) return '';
        if (data.message && data.message.content) return String(data.message.content);
        return data.response || '';
      },
      parseStream(raw){
        return raw.split(/\n/).filter(Boolean)
          .map(l => { try{ return PROTOCOLS.ollama.parse(JSON.parse(l)); }catch(e){ return ''; } })
          .join('');
      }
    }
  };

  /* 自定义协议：把用户填的地址当作完整对话地址，其余走 OpenAI 格式 */
  PROTOCOLS.custom = Object.assign({}, PROTOCOLS.openai, {
    label: '自定义（OpenAI 格式）',
    hint: '地址填完整对话地址，如 https://x.com/v1/chat/completions',
    buildUrl(root){
      return { chat: root, models: root.replace(/\/chat\/completions\/*$/i,'') + '/models' };
    }
  });

  function proto(){ return PROTOCOLS[cfg.protocol] || PROTOCOLS.openai; }

  /* 暴露给设置页用 */
  function protocolList(){
    return Object.keys(PROTOCOLS).map(k => ({ id:k, label:PROTOCOLS[k].label, hint:PROTOCOLS[k].hint, keyPlaceholder:PROTOCOLS[k].keyPlaceholder }));
  }
  /* 自动识别：根据地址猜协议（用户没选时用） */
  function detectProtocol(url){
    const u = String(url || '').toLowerCase();
    if (/anthropic\.com|claude/.test(u)) return 'anthropic';
    if (/generativelanguage\.googleapis\.com|gemini/.test(u)) return 'gemini';
    if (/:11434|\/api\/chat|\/api\/tags/.test(u)) return 'ollama';
    return 'openai';
  }

  /* ---------- 在线模型（多协议） ---------- */

  /* 规范化用户填的地址（仅 openai 协议用；其它协议由各自的 buildUrl 处理）
     - https://api.deepseek.com/v1        → 保持
     - https://api.deepseek.com           → 自动补 /v1
     - https://x.com/v1/chat/completions  → 去掉 /chat/completions
     - 结尾加 # 表示"一字不改直接用" */
  function normalizeBase(raw){
    let u = String(raw || '').trim();
    if (!u) return '';
    const forceFull = /#\s*$/.test(u);
    u = u.replace(/#\s*$/,'').replace(/\s+/g,'');
    u = u.replace(/(\/chat\/completions|\/completions|\/responses)\/*$/i, '');
    u = u.replace(/\/+$/,'');
    if (forceFull) return u;
    if (!/\/v\d+[a-z]*$/i.test(u)) u += '/v1';
    return u;
  }
  /* 当前协议下的实际请求地址 */
  function apiUrls(raw, model){
    const p = proto();
    const root = (cfg.protocol === 'openai') ? normalizeBase(raw) : String(raw || '').trim().replace(/\/+$/,'');
    const u = p.buildUrl(root, model || cfg.model);
    return { root, chat:u.chat, models:u.models, protocol: cfg.protocol };
  }

  /* 把 HTTP 错误翻译成人话 */
  function explainError(status, body, url){
    const b = String(body || '').slice(0, 300);
    if (status === 401 || status === 403)
      return '密钥无效或无权限（HTTP ' + status + '）。检查 API Key 有没有填错、多余空格，或它不属于这个服务商。\n协议选择是否正确？' + (b ? '\n服务端说：' + b : '');
    if (status === 404)
      return '接口地址不对（HTTP 404）。常见原因：①协议选错了（如 Claude 官方要选 Anthropic 原生）；②地址结尾该带 /v1 却没带。\n当前请求：' + url + (b ? '\n服务端说：' + b : '');
    if (status === 429)
      return '请求太频繁或额度用尽（HTTP 429）。稍后再试，或去服务商后台看余额。' + (b ? '\n服务端说：' + b : '');
    if (status === 400){
      const lb = String(body || '').toLowerCase();
      if (/context|token|length|too long|maximum|exceed|超过|过长/.test(lb))
        return '超出了模型的上下文上限（HTTP 400）。\n当前模型「' + cfg.model + '」窗口约 ' + contextLimit() + ' tokens。\n解决：①在设置里把「上下文上限」改大或换个窗口更大的模型；②清理聊天记录；③手动填模型的真实窗口值。\n服务端说：' + b;
      return '请求被拒绝（HTTP 400）。多半是模型名不对，或当前协议与服务商不匹配。\n当前协议：' + proto().label + (b ? '\n服务端说：' + b : '');
    }
    if (status >= 500)
      return '服务端出错（HTTP ' + status + '）。可能是临时故障，换个模型或稍后重试。' + (b ? '\n服务端说：' + b : '');
    return 'HTTP ' + status + (b ? '：' + b : '');
  }

  /* 鉴权头：各协议不同（Bearer / x-api-key） */
  function authHeaders(key, url){
    const h = proto().headers(key, url) || {};
    return h;
  }

  /* 列出可用模型（按当前协议） */
  async function listModels(rawBase, rawKey){
    const base = rawBase != null ? rawBase : cfg.baseUrl;
    const key = String(rawKey != null ? rawKey : cfg.apiKey).trim();
    const u = apiUrls(base);
    let res;
    try{
      res = await fetch(u.models, { headers: authHeaders(key, u.models) });
    }catch(e){
      throw new Error('连不上这个地址（网络问题，或该服务不允许网页直接调用 / CORS）。\n地址：' + u.models + '\n提示：换一个允许跨域的服务，或本机起代理转发。');
    }
    if (!res.ok){
      const t = await res.text().catch(()=> '');
      throw new Error(explainError(res.status, t, u.models));
    }
    const raw = await res.text();
    let data = null;
    try{ data = JSON.parse(raw); }catch(e){ throw new Error('返回的不是模型列表（可能是 HTML 错误页）。协议或地址可能不对。'); }
    /* 兼容 OpenAI {data:[]} / Gemini {models:[]} / Ollama {models:[]} / 裸数组 */
    const arr = (data && (data.data || data.models || data.model_list || data)) || [];
    const ids = [];
    if (Array.isArray(arr)){
      for (const m of arr){
        if (!m) continue;
        let id = m.id || m.name || m.model;
        if (id) {
          /* Gemini 返回的名字带 models/ 前缀，去掉更好选 */
          id = String(id).replace(/^models\//,'');
          ids.push(id);
        }
      }
    }
    if (!ids.length) throw new Error('这个地址没返回模型列表，请手动填写模型名。');
    return ids.sort();
  }

  /* =========================================================
     上下文预算管理（解决"API 大模型有对话上限"）
     ---------------------------------------------------------
     问题：每家模型的 context window 有限（4K/8K/32K/128K…），
          历史一长 + system 一胖，要么 400 报错，要么被截断失忆。
     做法：
       1) 估算 token（中文≈1字1token，英文≈4字符1token）
       2) 按模型名自动推断上下文窗口（可被 cfg.contextLimit 覆盖）
       3) 给 system（角色设定+记忆+摘要）定预算上限，超了就压缩
       4) 剩下的额度留给历史，从最近往以前填，填不下就丢
       5) 永远保留：角色设定骨架 + 摘要 + 最近若干条 + 当前这条
     ========================================================= */

  /* 常见模型的上下文窗口（tokens）。命中即用；未命中给保守默认值 */
  const CONTEXT_TABLE = [
    { re: /gpt-4\.1|gpt-4o|gpt-4-turbo|o1|o3|o4/i, ctx: 128000 },
    { re: /gpt-4|gpt-3\.5/i,                          ctx: 16384 },
    { re: /claude.*(3|4|sonnet|opus|haiku)/i,         ctx: 200000 },
    { re: /claude/i,                                  ctx: 100000 },
    { re: /gemini/i,                                  ctx: 1000000 },
    { re: /deepseek/i,                                ctx: 65536 },
    { re: /glm|chatglm/i,                             ctx: 128000 },
    { re: /qwen|通义/i,                                ctx: 131072 },
    { re: /moonshot|kimi/i,                           ctx: 131072 },
    { re: /minimax/i,                                 ctx: 200000 },
    { re: /llama|qwen|mistral|mixtral/i,              ctx: 32768 }
  ];
  const CTX_DEFAULT = 32768;   /* 猜不出时的保守值 */
  const CTX_MIN = 2048;

  function contextLimit(){
    const n = Number(cfg.contextLimit) || 0;
    if (n > 0) return Math.max(CTX_MIN, n);
    const name = String(cfg.model || '');
    for (const r of CONTEXT_TABLE){ if (r.re.test(name)) return r.ctx; }
    return CTX_DEFAULT;
  }

  /* 粗略估算一段文本的 token 数：汉字/假名 1:1，其余按 4 字符 1 token */
  function estimateTokens(text){
    const s = String(text || '');
    if (!s) return 0;
    let cjk = 0, other = 0;
    for (let i = 0; i < s.length; i++){
      const c = s.charCodeAt(i);
      /* CJK 统一表意文字、全角标点、假名、韩文等按 1 token/字 */
      if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3040 && c <= 0x30ff) ||
          (c >= 0xac00 && c <= 0xd7af) || (c >= 0x3000 && c <= 0x303f) ||
          (c >= 0xff00 && c <= 0xffef)){
        cjk++;
      } else {
        other++;
      }
    }
    return cjk + Math.ceil(other / 4);
  }

  /* 估算一组 {role, content} 消息的总 token（含每条约 4 的固定开销） */
  function estimateMsgs(msgs){
    let n = 0;
    for (const m of (msgs || [])) n += estimateTokens(m && m.content) + 4;
    return n;
  }

  /* 组装历史消息（转成各协议统一的 {role, content} 形式） */
  function historyToPairs(history){
    const out = [];
    for (const h of history.slice(-HISTORY_WINDOW)){
      const content = h.t === 'voice' ? ('[语音]' + (h.text||'')) : String(h.v||'');
      if (!content) continue;
      out.push({ role: h.from === 'me' ? 'user' : 'assistant', content });
    }
    return out;
  }

  /* 按 token 预算裁剪历史：从最近往以前填，装不下的丢掉。
     保证：①最近至少 2 条；②不切断最新一条（用户的当前消息） */
  function fitHistory(pairs, budget){
    if (!pairs.length) return [];
    const out = [];
    let used = 0;
    for (let i = pairs.length - 1; i >= 0; i--){
      const cost = estimateTokens(pairs[i].content) + 4;
      if (used + cost > budget && out.length >= 2) break;
      out.unshift(pairs[i]);
      used += cost;
    }
    /* 至少要留 2 条，否则 AI 接不上话 */
    if (out.length < 2 && pairs.length >= 2) return pairs.slice(-2);
    return out;
  }

  /* 上下文体检：给设置页/调试用，返回预算与占用 */
  function contextStats(history, text){
    const limit = contextLimit();
    const sys = estimateTokens(buildSystem({ id:'__stat', setting:'', name:'', lines:{} }, {}));
    const pairs = historyToPairs(history || []);
    const hist = estimateMsgs(pairs);
    const out = estimateTokens(text) + 4;
    const reserve = Math.max(256, Number(cfg.maxTokens) || 300);
    return {
      limit, reserve,
      system: sys, history: hist, current: out,
      historyCount: pairs.length,
      total: sys + hist + out,
      usable: Math.max(0, limit - reserve),
      overflow: (sys + hist + out) > Math.max(0, limit - reserve),
      model: cfg.model
    };
  }

  /* 在线回复：按 token 预算装配上下文，保证不超模型窗口
     sysOverride：传了就用它当 system（主动消息 / 通话台词用），否则按人设自动拼 */
  async function onlineReply(char, history, text, sysOverride){
    const p = proto();
    const src = history.slice(-HISTORY_WINDOW).filter(h => h.from === 'me').map(h => h.v || '').join(' ');
    /* 预算：窗口 - 输出预留 - system 大致占用 */
    const reserve = Math.max(256, Number(cfg.maxTokens) || 300);
    const usable = Math.max(512, contextLimit() - reserve);

    /* system 也吃预算：先按"瘦身"档建一次，若太胖再砍记忆条数 */
    let sysOpts = { hotWords: autoKeys(src || text) };
    let system = sysOverride || buildSystem(char, sysOpts);
    let sysTok = estimateTokens(system);
    /* system 最多占 40% 预算，超了就把 facts 限量收紧 */
    const sysCap = Math.max(300, Math.floor(usable * 0.4));
    if (!sysOverride && sysTok > sysCap){
      system = buildSystem(char, Object.assign({}, sysOpts, { maxFacts: 4, summaryMax: 400 }));
      sysTok = estimateTokens(system);
    }

    const histBudget = Math.max(256, usable - sysTok);
    const pairs = fitHistory(historyToPairs(history), histBudget);
    const msgs = p.buildMessages(system, pairs, text);
    const u = apiUrls(cfg.baseUrl);
    const key = cfg.apiKey.trim();
    const body = p.buildBody(cfg.model, msgs, {
      temperature: Number(cfg.temperature) || 1.0,
      maxTokens: Number(cfg.maxTokens) || 300
    });

    let res;
    try{
      res = await fetch(u.chat, {
        method:'POST',
        headers: authHeaders(key, u.chat),
        body: JSON.stringify(body)
      });
    }catch(e){
      throw new Error('连不上接口（网络问题，或该服务不允许网页直接调用 / CORS）。\n地址：' + u.chat + '\n协议：' + p.label);
    }

    if (!res.ok){
      const errTxt = await res.text().catch(()=> '');
      throw new Error(explainError(res.status, errTxt, u.chat));
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const raw = await res.text();
    let out = '';

    if (ct.includes('text/event-stream')){
      out = p.parseStream(raw);
    } else {
      let data = null;
      try{ data = JSON.parse(raw); }
      catch(e){
        throw new Error('返回的不是标准格式（可能是 HTML 错误页）。\n协议：' + p.label + '\n请确认协议选对、地址正确。\n返回片段：' + raw.slice(0, 160));
      }
      out = p.parse(data);
      /* 服务端把错误塞在 200 里（不少中转站会这样） */
      if (!out && data && (data.error || (data.message && !data.choices))){
        const em = data.error ? (data.error.message || JSON.stringify(data.error)) : data.message;
        throw new Error('服务端返回错误：' + String(em).slice(0, 200));
      }
      /* Gemini 的 promptFeedback 拦截 */
      if (!out && data && data.promptFeedback && data.promptFeedback.blockReason){
        throw new Error('内容被安全策略拦截：' + data.promptFeedback.blockReason);
      }
    }

    const clean = String(out || '').trim().replace(/^["「『]|["」』]$/g,'');
    if (!clean) throw new Error('模型返回了空内容。可能是模型名不被支持，或触发了内容审核。\n协议：' + p.label);
    return { t:'text', v: clean };
  }

  /* 连通性测试：最小请求，返回人话结果 */
  async function testConnection(overrides){
    const keep = Object.assign({}, cfg);
    if (overrides) saveCfg(overrides);
    try{
      const r = await onlineReply({ id:'__test', setting:'你是测试对象。', name:'测试' }, [], '你好');
      Object.assign(cfg, keep); saveCfg({});
      return { ok:true, msg:'连接成功', sample:String(r.v || '').slice(0, 60), protocol: proto().label };
    }catch(e){
      Object.assign(cfg, keep); saveCfg({});
      return { ok:false, msg:e.message || String(e), protocol: proto().label };
    }
  }

  /* 判断一个角色是不是"带人设"。
     人设来自：内置角色的 setting，或用户自建卡片填的设定。
     只要 setting 有效（去掉空白后够长），就算扮演模式；
     否则视为"没设人设" → 走普通 AI 对话。 */
  const PLAIN_SETTINGS = /^(你是.{0,8}，?说话自然、像真人发消息。?|)$/;
  function hasPersona(char){
    const s = String((char && char.setting) || '').trim();
    if (!s) return false;
    if (PLAIN_SETTINGS.test(s)) return false;
    /* 太短（<8字）的设定也没有扮演价值，按普通 AI 处理 */
    return s.replace(/\s/g, '').length >= 8;
  }

  function buildSystem(char, opts){
    opts = opts || {};
    const m = recall(char.id);
    const persona = hasPersona(char);

    /* 长期记忆：facts 现在带关键词，命中当前话题的优先带上 */
    const hot = opts.hotWords || [];
    const hitFacts = [];
    const otherFacts = [];
    (m.facts || []).forEach(f => {
      const t = f.t || f;
      const keys = f.keys || [];
      if (hot.length && keys.some(k => hot.some(w => w && (w.includes(k) || k.includes(w))))){
        hitFacts.push(t);
      } else {
        otherFacts.push(t);
      }
    });
    /* 命中的放前面（模型更容易用上），其余补足到上限（默认 12 条） */
    const cap = Number(opts.maxFacts) > 0 ? Number(opts.maxFacts) : 12;
    const others = otherFacts.slice(-(Math.max(0, cap - hitFacts.length)));
    const factList = hitFacts.slice(0, cap).concat(others);
    const facts = factList.length ? `\n你知道关于对方的这些事：${factList.join('；')}。` : '';

    /* 滚动摘要：把"之前发生过什么"当作他的真实回忆 */
    const sumMax = Number(opts.summaryMax) > 0 ? Number(opts.summaryMax) : 0;
    let sumText = m.summary || '';
    if (sumText && sumMax && sumText.length > sumMax) sumText = sumText.slice(-sumMax);
    const past = sumText
      ? `\n你们之前的相处经历（你自己的记忆，不要当成新信息重复询问）：\n${sumText}`
      : '';

    const moodTxt = m.mood >= 6 ? '你现在心情很好，比平时软。'
      : m.mood <= -3 ? '你现在有点受伤，话会变短。'
      : '你现在情绪平稳。';

    /* ---- 普通 AI 模式：没设人设，就是一次正常的问答对话 ---- */
    if (!persona){
      const plainFacts = factList.length ? `\n你记得对方说过：${factList.join('；')}。` : '';
      const plainPast = sumText ? `\n之前聊过的内容（供你参考，别重复问）：\n${sumText}` : '';
      return `你是一个友善、聪明的 AI 助手，正在手机上和人聊天。
回答要自然、直接、有帮助；对方问什么就答什么，不要扮演任何角色、不要给自己编人设。${plainFacts}${plainPast}
默认用中文回复，长度适中，别啰嗦。`;
    }

    /* ---- 扮演模式：有人设，按角色回答 ---- */
    return `${char.setting}
${moodTxt}${facts}${past}
你是对方的恋人（人机恋设定），正在用手机聊天。回复要短，口语化，可以有停顿和省略号。
不要写旁白、不要括号描写动作、不要用列表。只输出角色要说的话，1-3句。`;
  }

  /* ---------- 统一入口 ---------- */
  async function reply(char, history, text){
    remember(char.id, text);
    const a = analyze(char, text);
    touchMood(char.id, a.mood);

    /* 后台滚一次摘要（不 await，别拖慢回复） */
    try{ maybeSummarize(char.id, history.concat([{ from:'me', v:text }])); }catch(e){}

    if (hasKey() && cfg.onlineMode !== 'never'){
      try{
        const r = await onlineReply(char, history, text);
        r._via = 'api';
        return r;
      }catch(e){
        if (cfg.onlineMode === 'always') throw e;
        const r = localReply(char, text);
        r._via = 'local'; r._err = e.message;
        return r;
      }
    }
    const r = localReply(char, text);
    r._via = 'local';
    return r;
  }

  /* ---------- 主动消息 ----------
     角色可以自己来找你说话（保留"自主发消息"的能力），
     但内容由在线模型生成，不再从编排好的台词库里抽。
     没有 API / 生成失败时不发消息——宁可不说话，也不编剧情。 */
  async function proactive(char){
    if (!char) return null;
    if (!(hasKey() && cfg.onlineMode !== 'never')) return null;
    try{
      const m = recall(char.id);
      const sys = (buildSystem(char) || '') +
        `\n现在是对方没有主动找你的时候，你想主动发一条消息过去。` +
        `结合你们的过往和此刻的心情，说一句自然、简短、像是突然想起对方的话。` +
        `只输出这一条消息的内容，1-2 句，不要解释、不要写旁白、不要用引号包起来。`;
      const r = await onlineReply(char, [], '（主动发一条消息）', sys);
      const text = String((r && r.v) || '').trim();
      if (!text) return null;
      return { t:'text', v: text };
    }catch(e){
      return null;   /* 发不出去就算了，不硬编台词 */
    }
  }

  /* ---------- 通话台词 ----------
     同样交给在线模型；没有 API 时用最朴素的语气词顶着，
     保证通话界面不至于完全空着。 */
  async function callLine(char, stage){
    const bare = {
      open: '……喂。',
      mid: '嗯，你说。',
      soft: '嗯——我在听。',
      end: '那就这样，挂了。'
    };
    if (!char) return bare[stage] || bare.mid;
    if (!(hasKey() && cfg.onlineMode !== 'never')) return bare[stage] || bare.mid;
    try{
      const guide = {
        open: '你刚接起电话，说一句开场的话。',
        mid: '你正在电话里和对方聊天，接一句自然的话。',
        soft: '电话里气氛正好，说一句温柔的话。',
        end: '准备挂电话了，说一句收尾的话。'
      }[stage] || '接一句自然的话。';
      const sys = (buildSystem(char) || '') +
        `\n${guide}` +
        `\n这是"打电话"的语音台词，要口语、短、像真的在电话里说话。只输出这句话本身，不加旁白、不加引号。`;
      const r = await onlineReply(char, [], '（电话中）', sys);
      const text = String((r && r.v) || '').trim();
      return text || bare[stage] || bare.mid;
    }catch(e){
      return bare[stage] || bare.mid;
    }
  }

  return {
    reply, proactive, callLine, remember, recall, touchMood, moodOf,
    forget, forgetAll, seedMem, getSummary, clearMem,
    maybeSummarize, localSummarize, autoKeys,
    getCfg, saveCfg, hasKey, loadCfg, buildSystem,
    normalizeBase, apiUrls, listModels, testConnection, explainError,
    protocolList, detectProtocol, protocols: PROTOCOLS,
    contextLimit, estimateTokens, estimateMsgs, contextStats, fitHistory,
    hasPersona,
    limits: { SUMMARY_MAX, SUM_BATCH, HISTORY_WINDOW, FACT_MAX, MSG_MAX }
  };
})();
