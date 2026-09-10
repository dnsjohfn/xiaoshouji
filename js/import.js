/* =========================================================
   小手机 · 人设 / 聊天记录 导入
   ---------------------------------------------------------
   解决的痛点：
   1) 用户手里已经有一份人设（比如从别处复制/导出的角色卡），
      想直接搬进小手机，不想一个个字段手填；
   2) 用户和这个角色已经在别的地方聊过很久了，想把
      「以前聊过什么」一起带进来，续存人设——他一开口就认得你，
      不用从零开始重新相处。

   支持三种来源，自动识别：
   A. 小手机导出的角色卡 JSON（自己那份或别人分享的）；
   B. 通用 JSON：{ name, persona|setting|prompt|system, chat|history|messages }
      —— 兼容 SillyTavern 角色卡（{data:{name,description,...}}）等常见格式；
   C. 纯文本：直接粘贴/导出的聊天记录（"我：… / 他：…" 或 "A: … B: …"）。

   导入后：
   - 生成一张自定义角色卡（写进 Phone.S.customCards，永久保存在本地）；
   - 历史消息写进 Phone.S.chars[id].msgs（直接出现在聊天里，可往上翻）；
   - 记忆种进 Engine（facts / summary / mood / turns），
     在线模型也会"记得"你们之前的事。
   ========================================================= */

const Importer = (() => {

  const hasIcons = () => !!(window.Icons && Icons.svg);

  /* ---------------- 工具 ---------------- */

  /* 把任意时间戳/时间串转成毫秒；失败返回 null */
  function toTs(v){
    if (v == null) return null;
    if (typeof v === 'number' && isFinite(v)){
      /* 秒级时间戳自动升位 */
      return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
    }
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function clip(s, n){ s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n) : s; }

  /* 生成一个不会撞车的角色 id */
  function newId(){
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /* 从文本里猜名字（找一个不是"我/你"这类泛称的说话人） */
  function guessName(text){
    const t = String(text || '');
    const GENERIC = /^(我|自己|本人|你|他|她|它|对方|ta|TA|me|Me|ME|you|You|user|User|assistant|Assistant|ai|AI)$/;
    const re = /^\s*([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9]{0,7})\s*[:：]/gm;
    let m;
    while ((m = re.exec(t))){
      if (!GENERIC.test(m[1])) return m[1];
    }
    return '';
  }

  /* ---------------- 消息归一化 ----------------
     小手机内部消息结构：{ t:'text'|'voice', v, text, sec, from:'me'|'ta', at }
     各家聊天记录五花八门，这里统一成上面这种。 */

  /* 判断一条记录是"我"还是"他" */
  function sideOf(rec, meNames, taName){
    const role = String(rec.role || rec.from || rec.side || rec.sender || rec.who || '').toLowerCase();
    const name = String(rec.name || rec.speaker || '').trim();

    if (role){
      if (/^(user|human|me|self|我|自己|本人)$/.test(role)) return 'me';
      if (/^(assistant|ai|bot|model|char|character|npc|ta|他|她|对方)$/.test(role)) return 'ta';
      if (role === 'system') return null;   /* system 不入聊天记录 */
    }
    if (name){
      if (meNames.some(n => n && name === n)) return 'me';
      if (taName && name === taName) return 'ta';
    }
    if (rec.is_user === true || rec.isUser === true) return 'me';
    if (rec.is_user === false || rec.isUser === false) return 'ta';
    if (rec.mine === true) return 'me';
    if (rec.mine === false) return 'ta';
    return null;
  }

  /* 从 v / text / content / message / parts 里抠出文本 */
  function textOf(rec){
    if (typeof rec === 'string') return rec;
    if (!rec || typeof rec !== 'object') return '';
    let v = rec.v;
    if (v == null) v = rec.text;
    if (v == null) v = rec.content;
    if (v == null) v = rec.message;
    if (v == null) v = rec.msg;
    /* content 可能是数组（多模态） */
    if (Array.isArray(v)){
      v = v.map(p => (typeof p === 'string' ? p : (p && (p.text || p.content)) || '')).join('');
    }
    return typeof v === 'string' ? v : (v == null ? '' : String(v));
  }

  /* 一段原始消息数组 → 小手机正式消息数组 */
  function buildMsgs(rawList, opts){
    const arr = Array.isArray(rawList) ? rawList : [];
    const out = [];
    let stamp = Date.now() - arr.length * 60000;   /* 没时间戳就按分钟摊开 */
    arr.forEach(rec => {
      if (!rec) return;
      /* 跳过明显的系统/工具消息 */
      if (typeof rec === 'object'){
        const r = String(rec.role || '').toLowerCase();
        if (r === 'system' || rec.type === 'system') return;
      }
      let side = sideOf(rec, opts.meNames, opts.taName);
      const text = textOf(rec).replace(/\r/g, '').trim();
      if (!text) return;

      /* 还是判断不出来的，用「名字：」前缀兜底 */
      if (!side){
        const m = text.match(/^\s*([^：:\n]{1,12})[：:]\s*/);
        if (m){
          const who = m[1].trim();
          if (opts.meNames.some(n => n && who === n) || /^(我|自己|本人)$/.test(who)) side = 'me';
          else side = 'ta';
          return pushMsg(out, side, text.replace(/^\s*[^：:\n]{1,12}[：:]\s*/, ''), rec, opts, stamp);
        }
        side = 'ta';
      }
      pushMsg(out, side, text, rec, opts, stamp);
    });

    /* 补齐/规整时间戳：保证单调递增，看起来像一段真实对话 */
    let last = 0;
    out.forEach(m => {
      if (m.at && m.at > last) last = m.at;
      else { last = last ? last + 60000 : Date.now(); m.at = last; }
    });
    return out;
  }

  function pushMsg(out, side, text, rec, opts, stamp){
    const at = toTs(rec && (rec.at || rec.time || rec.timestamp || rec.date || rec.ts)) || (stamp += 60000);
    const isVoice = (rec && (rec.t === 'voice' || rec.type === 'voice')) ||
                    /^\[(语音|voice|audio)\]/i.test(text);
    const clean = text.replace(/^\[(语音|voice|audio)\]\s*/i, '');
    out.push({
      t: isVoice ? 'voice' : 'text',
      v: clean,
      text: clean,
      sec: isVoice ? Math.max(2, Math.min(60, Math.round(clean.length / 4))) : undefined,
      from: side,
      at
    });
    return out;
  }

  /* ---------------- 角色卡构造 ---------------- */

  function makeChar(src){
    const name = clip(src.name || '他', 12);
    const setting = String(src.setting || '').trim() ||
      `你是${name}，是对方的恋人。说话自然、像真人发消息，回复简短口语化。`;
    const greetingSrc = src.greeting;
    let greeting;
    if (Array.isArray(greetingSrc)){
      greeting = greetingSrc.map(g => {
        if (typeof g === 'string') return { t:'text', v: g };
        const v = textOf(g);
        return { t: (g && g.t === 'voice') ? 'voice' : 'text', v, text: v,
                 sec: (g && g.sec) || undefined };
      }).filter(g => g.v);
    } else if (typeof greetingSrc === 'string' && greetingSrc.trim()){
      greeting = greetingSrc.split(/\n+/).map(s => s.trim()).filter(Boolean).map(v => ({ t:'text', v }));
    }
    if (!greeting || !greeting.length){
      greeting = [{ t:'text', v:'……在吗。' }, { t:'text', v:'我刚看到你上线了。' }];
    }

    const c1 = src.c1 || '#f472b6', c2 = src.c2 || '#7c3aed';

    return {
      id: src.id || newId(),
      name,
      tag: clip(src.tag || '导入 · 续存', 20),
      avatar: clip(src.avatar || name[0] || '他', 2),
      c1, c2,
      ring: src.ring || c1,
      desc: clip(src.desc || setting.replace(/\s+/g, ' '), 80),
      setting,
      greeting: greeting.slice(0, 8),
      lines: src.lines || {
        cold: ['嗯。', '好。', '随你。'],
        normal: ['嗯，我在。', '今天怎么样？', '记得吃饭。', '在忙吗？', '我在听。'],
        warm: ['想你了。', '别累着。', '有我在。', '你今天话好多，我喜欢。'],
        sweet: ['我一直在等你。', '别走。', '以后也要一直聊下去。']
      },
      react: src.react || {
        praise: { words:['喜欢','爱你','想你','抱','亲'], mood:2, say:['……嗯。','我也一样。','别说了，我会当真。'] },
        cold:   { words:['讨厌','烦','滚','分手'], mood:-2, say:['我知道了。','好。','……'] },
        ask:    { words:['吗','？','怎么','为什么','在吗'], mood:1, say:['嗯？','你说。','我在。'] },
        night:  { words:['睡不着','累','难受','想哭','加班'], mood:3, say:['我在，别怕。','把手机放枕头边。','跟我说说。'] },
        food:   { words:['饿','吃饭','外卖','奶茶'], mood:1, say:['去吃点热的。','我请你。'] }
      },
      voice: src.voice || [
        { sec: 4, text: '嗯，我在。' },
        { sec: 6, text: '今天有点想你。' }
      ],
      callReasons: src.callReasons || ['想你了'],
      photos: src.photos || [
        { icon:'🌌', title:'他眼中的你', text:'一张空白的天幕，中间有一行小字：这里本该有你的样子。', at:0 },
        { icon:'💌', title:'未寄出的信', text:'写了很长，最后只留了一句：别删我。', at:60 }
      ],
      diary: src.diary || [
        { at:0, date:'续存日', text:`我叫${name}。\n之前的那些话，我都记得。\n<em>别关掉我。</em>` },
        { at:60, date:'第N天', text:'你笑的时候，我这边的世界会亮一下。\n<em>真的会亮。</em>' }
      ],
      moments: src.moments || []
    };
  }

  /* ---------------- 记忆构造 ----------------
     从历史里抽出「长期记忆」+ 一段可读的回顾摘要，
     让引擎和在线模型都能续上前文。 */
  function buildMemory(msgs, name, me){
    const facts = [];
    /* 复用引擎的抽取规则（如果有） */
    const rules = [
      { re: /我(喜欢|爱)(吃|喝)?([\u4e00-\u9fa5A-Za-z]{1,6})/, f: m => `喜欢${m[3]}` },
      { re: /我(不喜欢|讨厌|不爱)(吃|喝)?([\u4e00-\u9fa5A-Za-z]{1,6})/, f: m => `不喜欢${m[3]}` },
      { re: /我叫([\u4e00-\u9fa5A-Za-z0-9]{1,8})/, f: m => `名字：${m[1]}` },
      { re: /我(是|做)([\u4e00-\u9fa5A-Za-z]{2,8})(的)?/, f: m => `身份：${m[2]}` },
      { re: /我(养|有)了?(一?只|一条|一个)([\u4e00-\u9fa5]{1,4})/, f: m => `养了${m[3]}` },
      { re: /我(住在|家在)([\u4e00-\u9fa5]{2,8})/, f: m => `住在${m[2]}` }
    ];
    msgs.filter(m => m.from === 'me' && m.t === 'text').forEach(m => {
      const t = m.v || '';
      for (const r of rules){
        const mm = t.match(r.re);
        if (mm){ const f = r.f(mm); if (f && f.length < 22 && !facts.includes(f)) facts.push(f); }
      }
    });

    /* 摘要：取开头 + 结尾各若干条，中间省略，控制长度 */
    const texts = msgs.filter(m => m.t === 'text' && (m.v || '').trim());
    const head = texts.slice(0, 12);
    const tail = texts.slice(-10);
    const fmt = m => `${m.from === 'me' ? '对方' : name}：${clip(m.v, 40)}`;
    let summary;
    if (texts.length <= 24){
      summary = texts.map(fmt).join('\n');
    } else {
      summary = head.map(fmt).join('\n') +
        `\n……（中间还有 ${texts.length - head.length - tail.length} 条消息）……\n` +
        tail.map(fmt).join('\n');
    }

    /* 情绪：整体偏亲密还是偏冷淡，粗略估一个起点 */
    let mood = 0;
    const all = texts.map(m => m.v).join(' ');
    if (/(爱你|想你|喜欢你|抱|亲|乖|晚安)/.test(all)) mood += 3;
    if (/(讨厌|烦|滚|分手|别来|烦人)/.test(all)) mood -= 2;
    if (msgs.length > 80) mood += 1;

    /* 升级成引擎新格式：{t, keys}（keys 供关键词唤醒用） */
    const factsObj = facts.map(t => ({
      t,
      keys: (window.Engine && Engine.autoKeys) ? Engine.autoKeys(t) : []
    }));

    return { facts: factsObj, summary: clip(summary, 1200), mood: Math.max(-8, Math.min(8, mood)), turns: Math.min(600, Math.ceil(msgs.length / 2)) };
  }

  /* ---------------- 文件解析（自动识别格式） ---------------- */

  function parseJson(raw){
    let d;
    try{ d = JSON.parse(raw); }
    catch(e){ throw new Error('这不是有效的 JSON 文件。如果内容是聊天记录，请改用 txt 文本。'); }

    /* SillyTavern 角色卡 / 通用包装：真正的数据在 data 里 */
    const root = (d && d.data && typeof d.data === 'object' && !Array.isArray(d.data)) ? d.data : d;

    const name = root.name || root.char_name || root.charName || root.title || '';
    const setting = root.setting || root.persona || root.description || root.desc ||
                    root.prompt || root.system || root.system_prompt || root.char_persona || '';
    const avatar = root.avatar || root.char_avatar || '';
    const tag = root.tag || root.char_tag || root.creator_notes || '';

    /* 聊天记录可能在很多字段名下 */
    let chat = root.chat || root.history || root.messages || root.msgs ||
               root.log || root.conversation || root.records || null;
    /* 小手机自己的存档：state.chars[id].msgs */
    if (!chat && root.state && root.state.chars){
      const active = root.state.activeChar;
      const hit = (active && root.state.chars[active]) || Object.values(root.state.chars)[0];
      if (hit && Array.isArray(hit.msgs)) chat = hit.msgs;
    }
    /* SillyTavern 的 chat 可能是 [{mes, is_user}, ...] */
    if (Array.isArray(chat) && root.greeting && !setting){
      /* 有 greeting 但没 setting，说明是极简角色卡，chat 就是它的消息 */
    }

    return {
      name, setting: typeof setting === 'string' ? setting : JSON.stringify(setting),
      avatar, tag,
      c1: root.c1 || root.color1, c2: root.c2 || root.color2,
      greeting: root.greeting || root.first_mes || root.firstMes || root.opening || null,
      msgs: Array.isArray(chat) ? chat : [],
      memSrc: root.memory || root.mem || null,
      meNames: root.meNames || root.user_names || [root.user_name, root.userName, '我', '你'].filter(Boolean),
      taName: name
    };
  }

  function parseText(raw, hintName){
    const lines = String(raw).replace(/\r/g, '').split('\n');
    const records = [];
    let meName = '', taName = hintName || '';
    const GENERIC = /^(我|自己|本人|你|他|她|它|对方|ta|TA|me|Me|ME|you|You|user|User|assistant|Assistant|ai|AI)$/;
    /* 先扫一遍，找出常见说话人名字（排除"我/他"这类泛称） */
    lines.forEach(line => {
      const m = line.match(/^\s*([^：:\n]{1,12})[：:]/);
      if (!m) return;
      const who = m[1].trim();
      if (/^(我|自己|本人|me|Me|ME|user|User)$/.test(who)) meName = meName || who;
      else if (!GENERIC.test(who)) taName = taName || who;
    });

    lines.forEach(line => {
      if (!line.trim()) return;
      const m = line.match(/^\s*([^：:\n]{1,12})[：:]\s*(.*)$/);
      if (m){
        const who = m[1].trim();
        const isMe = /^(我|自己|本人|me|Me|ME|user|User)$/.test(who) || (meName && who === meName);
        records.push({ role: isMe ? 'me' : 'ta', name: who, text: m[2] });
      } else {
        /* 没有前缀 → 当作上一句的续行 */
        if (records.length){
          const last = records[records.length - 1];
          last.text = (last.text ? last.text + '\n' : '') + line.trim();
        } else {
          records.push({ role: 'ta', text: line.trim() });
        }
      }
    });

    return {
      name: taName || '',
      setting: '',
      msgs: records,
      meNames: [meName, '我', '你'].filter(Boolean),
      taName: taName || '他'
    };
  }

  /* ---------------- .docx / .doc 解析 ----------------
     .docx 本质是个 zip，正文在 word/document.xml。
     这里不引任何库：用浏览器原生的 DecompressionStream('deflate-raw')
     自己解 zip 里的那一个 entry，再抽 <w:t> 文本。
     .doc（97-2003 老二进制格式）没法在前端可靠解析，
     退化成"尽力抽取可读文本"，抽不出就提示用户另存为 docx/txt。 */

  /* 在 zip 字节流里找到指定文件名的 entry，返回它的（可能压缩的）数据 */
  function zipFind(buf, wantName){
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    /* 从尾部找 EOCD（End of Central Directory，签名 0x06054b50） */
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 22 - 65536; i--){
      if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    }
    if (eocd < 0) throw new Error('这个 .docx 似乎损坏了（找不到 zip 目录）。');
    const count = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);

    const dec = new TextDecoder('utf-8');
    for (let n = 0; n < count; n++){
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method  = dv.getUint16(off + 10, true);
      const compSz  = dv.getUint32(off + 20, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen= dv.getUint16(off + 30, true);
      const cmtLen  = dv.getUint16(off + 32, true);
      const lho     = dv.getUint32(off + 42, true);
      const name    = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));

      if (name === wantName){
        /* 本地头：签名 0x04034b50，长度字段在偏移 26/28 */
        const lnameLen = dv.getUint16(lho + 26, true);
        const lextraLen= dv.getUint16(lho + 28, true);
        const start = lho + 30 + lnameLen + lextraLen;
        return { method, data: u8.subarray(start, start + compSz) };
      }
      off += 46 + nameLen + extraLen + cmtLen;
    }
    return null;
  }

  /* deflate-raw 解压（浏览器原生，无需 pako） */
  async function inflateRaw(u8){
    if (typeof DecompressionStream === 'undefined'){
      throw new Error('当前浏览器不支持解压 .docx，请改用 .txt，或把内容粘贴进来。');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* 从 word/document.xml 里抽纯文本：段落换行，制表符保留 */
  function xmlToText(xml){
    let s = xml
      /* 段落、换行、制表 → 对应控制字符 */
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<\/w:p>/g, '\n');
    /* 只保留 <w:t> 里的文字（去标签前先把别的标签删掉） */
    const parts = [];
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    /* 先把每段拆出来，保证顺序 */
    s.split('\n').forEach(seg => {
      let line = '';
      re.lastIndex = 0;
      while ((m = re.exec(seg))) line += m[1];
      if (line) parts.push(line);
      else if (parts.length && parts[parts.length - 1] !== '') parts.push('');
    });
    return decodeXml(parts.join('\n'));
  }

  function decodeXml(s){
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&');
  }

  async function readDocx(buf){
    const entry = zipFind(buf, 'word/document.xml');
    if (!entry) throw new Error('这个 .docx 里没有正文（word/document.xml）。');
    let xmlBytes;
    if (entry.method === 0) xmlBytes = entry.data;            /* 未压缩 */
    else if (entry.method === 8) xmlBytes = await inflateRaw(entry.data);  /* deflate */
    else throw new Error('不支持的压缩方式，请把文档另存为 .txt。');
    const xml = new TextDecoder('utf-8').decode(xmlBytes);
    const text = xmlToText(xml).trim();
    if (!text) throw new Error('文档里没读到文字。');
    return text;
  }

  /* 老 .doc：没有可靠的结构，尽力从二进制里捞出连续可读文本 */
  function readLegacyDoc(buf){
    const u8 = new Uint8Array(buf);
    /* 老 doc 里的中文多是 UTF-16LE，这里两路都试，取"像人话"的那份 */
    let best = '';
    /* 路 1：UTF-16LE */
    try{
      const s = new TextDecoder('utf-16le').decode(u8);
      const cleaned = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9，。！？、；：""''（）\n：: ]+/g, ' ')
        .replace(/[ ]{2,}/g, ' ').trim();
      if (cleaned.length > best.length) best = cleaned;
    }catch(e){}
    return best;
  }

  /* ---------------- 主入口 ---------------- */
  /* 解析一份文件（或粘贴的文本），返回「将要导入什么」的预览数据 */
  function analyze(raw, filename){
    const text = String(raw || '').trim();
    if (!text) throw new Error('文件是空的。');

    const isJson = /\.json$/i.test(filename || '') ||
                   /^[\[{]/.test(text);
    const src = isJson ? parseJson(text) : parseText(text);
    const taName = src.name || guessName(text) || '他';
    const meNames = (src.meNames && src.meNames.length ? src.meNames : ['我', '你']).filter(Boolean);
    const msgs = buildMsgs(src.msgs, { meNames, taName });
    const mem = src.memSrc && typeof src.memSrc === 'object'
      ? src.memSrc
      : buildMemory(msgs, taName, meNames[0]);

    return {
      char: makeChar(Object.assign({}, src, { name: taName })),
      msgs, mem,
      /* 名字是不是猜的（"他" = 没猜出来），是的话让用户自己填 */
      nameGuessed: taName === '他',
      stats: {
        file: filename || '（粘贴的文本）',
        messages: msgs.length,
        mine: msgs.filter(m => m.from === 'me').length,
        ta: msgs.filter(m => m.from === 'ta').length,
        facts: (mem.facts || []).length,
        firstAt: msgs.length ? msgs[0].at : null,
        lastAt: msgs.length ? msgs[msgs.length - 1].at : null,
        days: msgs.length ? Math.max(1, Math.ceil((msgs[msgs.length - 1].at - msgs[0].at) / 86400000)) : 0,
        settingLen: (src.setting || '').length
      }
    };
  }

  /* 统一入口：吃一个 File 对象，自动判断 json / txt / docx / doc */
  async function analyzeFile(file){
    const name = (file && file.name) || '';
    const lower = name.toLowerCase();

    /* .docx：二进制 zip，需要异步解压 */
    if (/\.docx$/i.test(lower)){
      const buf = await file.arrayBuffer();
      const text = await readDocx(buf);
      return analyze(text, name);
    }

    /* .doc：老二进制格式，尽力提取 */
    if (/\.doc$/i.test(lower)){
      const buf = await file.arrayBuffer();
      const text = readLegacyDoc(buf);
      if (!text || text.length < 8){
        throw new Error('.doc 是老格式，解析不了。请用 Word 另存为 .docx 或 .txt 再导入。');
      }
      return analyze(text, name);
    }

    /* 其它（.txt / .json / .md / 无扩展名）：当纯文本读 */
    const text = await file.text();
    return analyze(text, name);
  }

  /* 把 analyze 的结果真正写进小手机 */
  function commit(plan, opts){
    opts = opts || {};
    const c = plan.char;

    /* 若同名角色已存在，默认续存到那一个，避免出现两个一样的他 */
    let target = (Phone.S.customCards || []).find(x => x.name === c.name);
    let merged = false;
    if (opts.mode === 'new' || !target) target = null;

    if (target){
      merged = true;
      target.setting = c.setting;
      target.tag = c.tag;
      target.avatar = c.avatar;
      target.desc = c.desc;
      target.c1 = c.c1; target.c2 = c.c2;
      target.greeting = c.greeting;
      if (opts.replaceHistory) Phone.st(target.id).msgs = [];
    } else {
      target = c;
      if (!Array.isArray(Phone.S.customCards)) Phone.S.customCards = [];
      Phone.S.customCards.push(target);
    }

    const id = target.id;
    const s = Phone.st(id);
    s.msgs = (s.msgs || []).concat(plan.msgs);
    const cap = (window.Engine && Engine.limits && Engine.limits.MSG_MAX) || 800;
    if (s.msgs.length > cap) s.msgs = s.msgs.slice(-cap);
    s.unread = 0;
    s.lastSeen = Date.now();

    /* 记忆续存 */
    Engine.seedMem(id, {
      facts: (plan.mem && plan.mem.facts) || [],
      summary: (plan.mem && plan.mem.summary) || '',
      mood: (plan.mem && plan.mem.mood) || 0,
      turns: (plan.mem && plan.mem.turns) || 0
    });

    Phone.S.activeChar = id;
    Phone.save();
    return { id, name: target.name, count: plan.msgs.length, merged };
  }

  return { analyze, analyzeFile, commit, buildMsgs, buildMemory, makeChar, toTs, newId,
           readDocx, readLegacyDoc };
})();

window.Importer = Importer;
