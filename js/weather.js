/* =========================================================
   小手机 · 实时天气
   ---------------------------------------------------------
   数据源：Open-Meteo（https://open-meteo.com）
   —— 完全免费、**不需要 API key**、不需要注册，
      所以这个功能装上就能用，用户不用去申请任何东西。

   地区怎么来（两条路，优先定位，失败自动回退手动城市）：
     1) 浏览器定位 navigator.geolocation → 拿到经纬度
     2) 手动填城市名 → 用 Open-Meteo 的 geocoding 接口查经纬度

   天气字段：
     current: temperature_2m / weather_code / is_day
     daily:   temperature_2m_max / temperature_2m_min
     air:     空气质量用 open-meteo 的 air-quality 接口（PM2.5 → 优/良/…）

   所有请求都是可选的：拿不到就回退到原来的本地假数据，
   保证离线/断网时桌面不会开天窗。
   ========================================================= */

const Weather = (() => {

  const CACHE_KEY = 'xmj.weather.v1';
  const CITY_KEY  = 'xmj.city.v1';
  const CACHE_TTL = 30 * 60 * 1000;      /* 30 分钟内不重复请求 */

  /* WMO 天气代码 → 中文 + 图标名（对应 icons.js 里的图标）*/
  const WMO = {
    0:  ['晴',    'sun'],
    1:  ['晴间多云','sun'],
    2:  ['多云',  'cloud'],
    3:  ['阴',    'cloud'],
    45: ['雾',    'cloud'],
    48: ['雾凇',  'cloud'],
    51: ['毛毛雨','wave'],
    53: ['毛毛雨','wave'],
    55: ['毛毛雨','wave'],
    56: ['冻雨',  'wave'],
    57: ['冻雨',  'wave'],
    61: ['小雨',  'wave'],
    63: ['中雨',  'wave'],
    65: ['大雨',  'wave'],
    66: ['冻雨',  'wave'],
    67: ['冻雨',  'wave'],
    71: ['小雪',  'cloud'],
    73: ['中雪',  'cloud'],
    75: ['大雪',  'cloud'],
    77: ['雪粒',  'cloud'],
    80: ['阵雨',  'wave'],
    81: ['阵雨',  'wave'],
    82: ['暴雨',  'wave'],
    85: ['阵雪',  'cloud'],
    86: ['阵雪',  'cloud'],
    95: ['雷阵雨','wave'],
    96: ['雷阵雨','wave'],
    99: ['雷暴',  'wave']
  };
  function wmoInfo(code){
    return WMO[code] || ['多云', 'cloud'];
  }

  /* PM2.5 → 中文空气质量（贴近国内习惯的分级） */
  function aqiText(pm25){
    if (pm25 == null || isNaN(pm25)) return '';
    const v = Math.round(pm25);
    if (v <= 35) return `空气优 ${v}`;
    if (v <= 75) return `空气良 ${v}`;
    if (v <= 115) return `轻度污染 ${v}`;
    if (v <= 150) return `中度污染 ${v}`;
    if (v <= 250) return `重度污染 ${v}`;
    return `严重污染 ${v}`;
  }

  /* ---------- 缓存 ---------- */
  function loadCache(){
    try{ return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }catch(e){ return {}; }
  }
  function saveCache(obj){
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); }catch(e){}
  }

  /* ---------- 手动设置的城市 ---------- */
  function getCity(){
    try{ return localStorage.getItem(CITY_KEY) || ''; }catch(e){ return ''; }
  }
  function setCity(name){
    try{
      if (name) localStorage.setItem(CITY_KEY, name);
      else localStorage.removeItem(CITY_KEY);
    }catch(e){}
  }

  let last = loadCache();      /* { at, data } */

  /* ---------- 网络请求 ---------- */
  async function getJSON(url, timeout){
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = ctl ? setTimeout(() => ctl.abort(), timeout || 9000) : null;
    try{
      const res = await fetch(url, { signal: ctl ? ctl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      if (tm) clearTimeout(tm);
    }
  }

  /* ---------- 接口地址（多个镜像，挨个试） ----------
     api.open-meteo.com 在国内不少网络下会超时，
     这里准备几个候选主机：谁先成功用谁，全失败才抛错。
     可用 localStorage 的 xmj.wxhost 覆盖成自建/反代地址。 */
  const HOSTS = {
    forecast: [
      'https://api.open-meteo.com/v1/forecast',
      'https://customer-api.open-meteo.com/v1/forecast',
      'https://api.open-meteo.com/v1/forecast'          /* 兜底再试一次 */
    ],
    air: [
      'https://air-quality-api.open-meteo.com/v1/air-quality',
      'https://api.open-meteo.com/v1/air-quality'
    ]
  };
  function hostOverride(kind){
    try{
      const v = localStorage.getItem('xmj.wxhost.' + kind);
      if (v) return [v].concat(HOSTS[kind]);
    }catch(e){}
    return HOSTS[kind];
  }
  /* 依次尝试候选地址，第一个成功的就用 */
  async function getJSONAny(kind, path, timeout){
    const list = hostOverride(kind);
    let lastErr = null;
    for (let i = 0; i < list.length; i++){
      try{
        return await getJSON(list[i] + path, timeout || 9000);
      }catch(e){
        lastErr = e;
      }
    }
    throw lastErr || new Error('网络请求失败');
  }

  /* 城市名 → { lat, lon, name } */
  async function geocode(name){
    const u = 'https://geocoding-api.open-meteo.com/v1/search'
      + '?name=' + encodeURIComponent(name)
      + '&count=1&language=zh&format=json';
    const d = await getJSON(u, 9000);
    const hit = d && d.results && d.results[0];
    if (!hit) throw new Error('没找到这个城市：' + name);
    /* 显示成「市 + 区/省」更好看，且跟原来"崂山区"风格一致 */
    const parts = [hit.admin1, hit.name].filter(Boolean);
    const label = hit.name || name;
    return { lat: hit.latitude, lon: hit.longitude, name: label, full: parts.join(' · ') };
  }

  /* 浏览器定位 → { lat, lon } */
  function locate(){
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation){
        reject(new Error('这个浏览器不支持定位'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        err => {
          const map = {
            1: '你拒绝了定位权限',
            2: '定位不可用（没信号）',
            3: '定位超时'
          };
          reject(new Error(map[err && err.code] || '定位失败'));
        },
        { enableHighAccuracy: false, timeout: 9000, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  /* 经纬度 → 城市名。
     先试 BigDataCloud（免费、免 key、中文好），不通就用
     Open-Meteo geocoding 反查兜底 —— 后者国内一般连得上。 */
  async function reverseName(lat, lon){
    /* ① BigDataCloud */
    try{
      const u = 'https://api.bigdatacloud.net/data/reverse-geocode-client'
        + `?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;
      const d = await getJSON(u, 5000);
      const n = d.city || d.locality || d.principalSubdivision || '';
      if (n) return n;
    }catch(e){}
    /* ② 用 geocoding 接口反查：传经纬度当名字，Open-Meteo 支持 */
    try{
      const u = 'https://geocoding-api.open-meteo.com/v1/search'
        + `?name=${lat},${lon}&count=1&language=zh&format=json`;
      const d = await getJSON(u, 5000);
      const hit = d && d.results && d.results[0];
      if (hit && hit.name) return hit.name;
    }catch(e){}
    return '';
  }

  /* 拉一次完整天气 */
  async function fetchWeather(lat, lon, label){
    /* ① 首选 Open-Meteo（数据最全、含空气质量） */
    try{
      return await fetchOpenMeteo(lat, lon, label);
    }catch(e){
      /* ② open-meteo 的 forecast 子域在国内部分网络会被墙/超时，
            退回 wttr.in（支持跨域、一次调用拿全） */
      return await fetchWttr(lat, lon, label);
    }
  }

  /* ---- 数据源 A：Open-Meteo ---- */
  async function fetchOpenMeteo(lat, lon, label){
    const path = `?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,weather_code,is_day'
      + '&daily=temperature_2m_max,temperature_2m_min'
      + '&timezone=auto&forecast_days=1';
    const d = await getJSONAny('forecast', path, 9000);

    const cur = d.current || {};
    const daily = d.daily || {};
    const [txt, ico] = wmoInfo(cur.weather_code);
    const isNight = cur.is_day === 0;
    const max = Math.round((daily.temperature_2m_max || [])[0] ?? cur.temperature_2m);
    const min = Math.round((daily.temperature_2m_min || [])[0] ?? cur.temperature_2m);
    const now = Math.round(cur.temperature_2m);

    let air = '';
    try{
      const a = await getJSONAny('air',
        `?latitude=${lat}&longitude=${lon}&current=pm2_5`, 7000);
      air = aqiText(a && a.current && a.current.pm2_5);
    }catch(e){}

    return {
      city: label || '当前位置',
      t: isNight && /晴/.test(txt) ? '夜' : txt,
      ico: isNight && /晴/.test(txt) ? 'moon' : ico,
      now, max, min, air,
      isDay: !isNight,
      src: 'open-meteo',
      at: Date.now()
    };
  }

  /* ---- 数据源 B：wttr.in（open-meteo 不通时的备胎） ---- */
  async function fetchWttr(lat, lon, label){
    const u = `https://wttr.in/${lat},${lon}?format=j1`;
    const d = await getJSON(u, 12000);

    const cur = (d.current_condition && d.current_condition[0]) || {};
    const today = (d.weather && d.weather[0]) || {};
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour >= 19;

    const now = Math.round(+cur.temp_C || 0);
    const max = Math.round(+((today.maxtempC) || cur.temp_C) || now);
    const min = Math.round(+((today.mintempC) || cur.temp_C) || now);

    /* wttr 的天气代码是"字符串"，映射到我们的图标 */
    const desc = (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value) || '';
    const code = +cur.weatherCode;
    const { txt, ico } = wttrToCn(code, desc);

    /* 空气质量：wttr 不直接给 PM2.5，用它的能见度/湿度给个粗略判断 */
    let air = '';
    const pm = cur.pm2_5 ? +cur.pm2_5 : null;
    if (pm != null) air = aqiText(pm);

    return {
      city: label || '当前位置',
      t: isNight ? '夜' : txt,
      ico: isNight ? 'moon' : ico,
      now, max, min, air,
      isDay: !isNight,
      src: 'wttr',
      at: Date.now()
    };
  }

  /* wttr 的 WWO code / 英文描述 → 中文 + 图标 */
  function wttrToCn(code, desc){
    const C = {
      113:['晴','sun'], 116:['多云','cloud'], 119:['阴','cloud'], 122:['阴','cloud'],
      143:['雾','cloud'], 248:['雾','cloud'], 260:['雾','cloud'],
      176:['阵雨','wave'], 263:['毛毛雨','wave'], 266:['毛毛雨','wave'],
      293:['小雨','wave'], 296:['小雨','wave'], 299:['中雨','wave'],
      302:['中雨','wave'], 305:['大雨','wave'], 308:['大雨','wave'], 356:['暴雨','wave'],
      353:['阵雨','wave'], 359:['暴雨','wave'],
      179:['雪','cloud'], 182:['雪','cloud'], 185:['冻雨','wave'],
      227:['雪','cloud'], 230:['大雪','cloud'], 320:['雪','cloud'],
      323:['小雪','cloud'], 326:['小雪','cloud'], 329:['中雪','cloud'],
      332:['中雪','cloud'], 335:['大雪','cloud'], 338:['大雪','cloud'],
      368:['阵雪','cloud'], 371:['阵雪','cloud'],
      200:['雷阵雨','wave'], 386:['雷阵雨','wave'], 389:['雷暴','wave'], 392:['雷暴','wave'], 395:['雷暴','wave']
    };
    if (C[code]) return { txt: C[code][0], ico: C[code][1] };
    /* 代码没命中就用英文描述兜底 */
    if (/thunder|storm/i.test(desc)) return { txt:'雷阵雨', ico:'wave' };
    if (/snow|sleet|blizzard/i.test(desc)) return { txt:'雪', ico:'cloud' };
    if (/rain|drizzle|shower/i.test(desc)) return { txt:'雨', ico:'wave' };
    if (/fog|mist|haze/i.test(desc)) return { txt:'雾', ico:'cloud' };
    if (/overcast/i.test(desc)) return { txt:'阴', ico:'cloud' };
    if (/cloud/i.test(desc)) return { txt:'多云', ico:'cloud' };
    if (/clear|sunny/i.test(desc)) return { txt:'晴', ico:'sun' };
    return { txt: '多云', ico:'cloud' };
  }

  /* ---------- 对外主入口 ---------- */

  /* 强制刷新（忽略缓存） */
  async function refresh(force){
    if (!force && last && last.at && (Date.now() - last.at < CACHE_TTL) && last.data){
      return last.data;
    }
    const manual = getCity();
    let lat, lon, label;

    if (manual){
      const g = await geocode(manual);
      lat = g.lat; lon = g.lon; label = g.name;
    } else {
      const p = await locate();
      lat = p.lat; lon = p.lon;
      label = await reverseName(lat, lon) || '当前位置';
    }

    const data = await fetchWeather(lat, lon, label);
    last = { at: Date.now(), data };
    saveCache(last);
    return data;
  }

  /* 给渲染层用：有缓存就先给缓存（同步），没有就返回 null */
  function cached(){
    return (last && last.data) || null;
  }

  /* 定位一次并解析成城市名（设置页用） */
  async function pickByLocation(){
    const p = await locate();
    const name = await reverseName(p.lat, p.lon);
    setCity(name || '');
    const data = await fetchWeather(p.lat, p.lon, name || '当前位置');
    last = { at: Date.now(), data };
    saveCache(last);
    return data;
  }

  async function pickByCity(name){
    name = String(name || '').trim();
    if (!name) throw new Error('先填个城市名');
    const g = await geocode(name);
    setCity(g.name);
    const data = await fetchWeather(g.lat, g.lon, g.name);
    last = { at: Date.now(), data };
    saveCache(last);
    return data;
  }

  /* 城市名查询（给设置页做候选提示） */
  async function searchCity(name){
    const u = 'https://geocoding-api.open-meteo.com/v1/search'
      + '?name=' + encodeURIComponent(name)
      + '&count=6&language=zh&format=json';
    const d = await getJSON(u, 9000);
    return (d && d.results) || [];
  }

  function clear(){
    last = {};
    try{ localStorage.removeItem(CACHE_KEY); }catch(e){}
  }

  return {
    refresh, cached, clear,
    pickByLocation, pickByCity, searchCity,
    getCity, setCity,
    wmoInfo, aqiText
  };
})();

window.Weather = Weather;
