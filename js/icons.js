/* ================================================================
   icons.js — 内联 SVG 图标库（替代 emoji，矢量可控色，不依赖系统字体）
   用法： Icons.svg('chat', 22)  →  返回 <svg>...</svg> 字符串
          Icons.el('chat', 22)   →  返回 SVG Element
   ================================================================ */
(function (w) {
  'use strict';

  /* 每个图标：viewBox 24x24，stroke 线稿风（currentColor 描边） */
  const P = {
    /* 消息 / 聊天 */
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.5 9.5 0 0 1-3.2-.6L3 21l1.7-5a8 8 0 0 1-.7-3.3 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8 7.2z"/>' +
          '<path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>',
    /* 通话 */
    call: '<path d="M21.5 16.9v2.6a1.8 1.8 0 0 1-2 1.8 17.6 17.6 0 0 1-7.7-2.8 17.3 17.3 0 0 1-5.3-5.3A17.6 17.6 0 0 1 3.7 5.4a1.8 1.8 0 0 1 1.8-2h2.6a1.8 1.8 0 0 1 1.8 1.6 11.6 11.6 0 0 0 .6 2.6 1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14 14 0 0 0 5.3 5.3l1.1-1.1a1.8 1.8 0 0 1 1.9-.4 11.6 11.6 0 0 0 2.6.6 1.8 1.8 0 0 1 1.6 1.9z"/>',
    /* 相册 / 图片 */
    gallery: '<rect x="3" y="4" width="18" height="16" rx="2.5"/>' +
             '<circle cx="8.5" cy="9.5" r="1.6"/>' +
             '<path d="m4 17 4.4-4.2a2 2 0 0 1 2.7 0L20 20"/>',
    /* 日记 / 书 */
    notes: '<path d="M4 5.2A2.2 2.2 0 0 1 6.2 3H19v15H6.2A2.2 2.2 0 0 0 4 20.2z"/>' +
           '<path d="M4 20.2A2.2 2.2 0 0 1 6.2 18H19v3H6.2A2.2 2.2 0 0 1 4 20.2z"/>',
    /* 设置 / 齿轮 */
    settings: '<circle cx="12" cy="12" r="3.1"/>' +
              '<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 7.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9.7a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    /* 调色盘（聊天背景） */
    palette: '<path d="M12 3a9 9 0 0 0 0 18 1.9 1.9 0 0 0 1.4-3.2 1.9 1.9 0 0 1 1.4-3.2h1.9A4.3 4.3 0 0 0 21 10.3C21 6.2 16.9 3 12 3z"/>' +
             '<circle cx="7.5" cy="10.5" r="1.2"/><circle cx="11" cy="7.5" r="1.2"/><circle cx="15.7" cy="8.3" r="1.2"/>',
    /* 麦克风 */
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/>' +
         '<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    /* 关闭 */
    close: '<path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"/>',
    /* 文件夹 / 上传 */
    folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.4h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
            '<path d="M12 11v5M9.7 13.3 12 11l2.3 2.3"/>',
    /* 锁 */
    lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.2"/>' +
          '<path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    /* 播放 */
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    /* 暂停 */
    pause: '<rect x="7" y="5.5" width="3.5" height="13" rx="1"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1"/>',
    /* 警告 */
    warn: '<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4M12 17h.01"/>',
    /* 对勾 */
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    /* 连接 / zap */
    zap: '<path d="M13.5 2.5 4 14h6.5L10 21.5 20 10h-6.5z"/>',
    /* 图表 */
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    /* 清理 / 垃圾 */
    trash: '<path d="M4 6.5h16M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5"/>' +
           '<path d="M6.5 6.5 7.5 20a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-13.5"/>' +
           '<path d="M10.5 10.5v7M13.5 10.5v7"/>',
    /* 心 */
    heart: '<path d="M12 20.5S3.5 15.4 3.5 9.6a4.6 4.6 0 0 1 8.5-2.4 4.6 4.6 0 0 1 8.5 2.4c0 5.8-8.5 10.9-8.5 10.9z"/>',
    /* 返回 */
    back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
    /* 加号 */
    plus: '<path d="M12 5v14M5 12h14"/>',
    /* 太阳（亮色） */
    sun: '<circle cx="12" cy="12" r="4"/>' +
         '<path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
    /* 月亮（夜色） */
    moon: '<path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a7 7 0 0 0 10.8 10.8z"/>',
    /* 云 */
    cloud: '<path d="M6.5 19h11a4 4 0 0 0 .3-8 6 6 0 0 0-11.5 1.6A3.7 3.7 0 0 0 6.5 19z"/>',
    /* 花（樱） */
    flower: '<circle cx="12" cy="12" r="2.2"/>' +
            '<path d="M12 9.8C12 7.6 10.8 6 12 4s3 2.4 0 5.8zM14.2 12c2.2 0 3.8-1.2 5.8 0s-2.4 3-5.8 0zM12 14.2c0 2.2 1.2 3.8 0 5.8s-3-2.4 0-5.8zM9.8 12C7.6 12 6 13.2 4 12s2.4-3 5.8 0z"/>',
    /* 深海 / 波浪 */
    wave: '<path d="M2 8.5c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/>' +
          '<path d="M2 15c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/>',
    /* 夜景城市 */
    city: '<path d="M3 21V8l6-4v17M9 21V11l5 3v7M14 21V9l7 3v9z"/>',
    /* 文档（纸） */
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>',
    /* 相机 */
    camera: '<path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h1.3l1.2-2h6l1.2 2h1.3a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>' +
            '<circle cx="12" cy="12.7" r="3.6"/>',
    /* 蛋糕 */
    cake: '<path d="M4.5 20.5h15M6 20.5v-6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6"/>' +
          '<path d="M12 12.5v-3M12 6.5V4"/><path d="M9 12.5c0-1 .8-1.4 1-2M15 12.5c0-1-.8-1.4-1-2"/>',
    /* 猫 */
    cat: '<path d="M5 10 4 4l4 2.4a8.6 8.6 0 0 1 8 0L20 4l-1 6"/>' +
         '<path d="M5 10a7 7 0 0 0 7 10 7 7 0 0 0 7-10"/><path d="M9.5 12h.01M14.5 12h.01M12 15.5h.01"/>',
    /* 铃铛（通知） */
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z"/>' +
          '<path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
    /* 用户（头像占位） */
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',

    /* ===== 参考图新增功能 ===== */
    /* 通讯录 */
    contacts: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9.5" cy="10.5" r="2.2"/>' +
              '<path d="M6 16.5a3.8 3.8 0 0 1 7 0M15 9.5h3M15 13h3"/>',
    /* 动态 / 网格 */
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/>' +
          '<rect x="13.5" y="3.5" width="7" height="7" rx="2"/>' +
          '<rect x="3.5" y="13.5" width="7" height="7" rx="2"/>' +
          '<rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    /* 角色 / 面具 */
    mask: '<path d="M4 5.5c2.6-.8 5.2-.8 8 0s5.4.8 8 0c0 6-1 10-4 13-2.4 2.4-5.6 2.4-8 0-3-3-4-7-4-13z"/>' +
          '<path d="M8.5 11h.01M15.5 11h.01"/><path d="M9 15.5c1.8 1.2 4.2 1.2 6 0"/>',
    /* 音乐 */
    music: '<path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="3"/>' +
           '<circle cx="16.5" cy="16" r="3"/>',
    /* 钱包 */
    wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/>' +
            '<path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>',
    /* 购物袋 */
    bag: '<path d="M5 8h14l1.2 12H3.8z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
    /* 书签 / 备忘录 */
    bookmark: '<path d="M6 3.5h12v17l-6-4-6 4z"/>',
    /* 上一曲 / 下一曲 */
    prev: '<path d="M18.5 5.5v13L9 12z"/><rect x="5" y="5.5" width="2.4" height="13" rx="1"/>',
    next: '<path d="M5.5 5.5v13L15 12z"/><rect x="16.6" y="5.5" width="2.4" height="13" rx="1"/>',
    /* 时钟 */
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    /* 星星 */
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
    /* 火焰（热度） */
    fire: '<path d="M12 21.5c3.6 0 6.5-2.7 6.5-6.2 0-4.6-4.4-6.3-4-11.3-2.8 1.4-4.6 4-4.6 6.1 0 1.5-.9 2-1.7 2-.9 0-1.6-.8-1.6-2.2C5 11.6 5.5 14 5.5 15.3c0 3.5 2.9 6.2 6.5 6.2z"/>',
    /* 下载 */
    download: '<path d="M12 3.5v11M8 11l4 4 4-4M4.5 19.5h15"/>',
    /* 刷新 */
    refresh: '<path d="M20 11.5a8 8 0 1 0-1.9 6.4"/><path d="M20 5v6h-6"/>',
    /* 扫一扫 / 二维码 */
    scan: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M20 8.5V6a2 2 0 0 0-2-2h-2.5M4 15.5V18a2 2 0 0 0 2 2h2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5"/>' +
          '<path d="M4 12h16"/>',
    /* 设置滑块（玩法） */
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/>' +
             '<circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'
  };

  /* 有些图标用填充更合适（实心） */
  const SOLID = { play: 1, pause: 1, heart: 1, lock: 1, close: 1, back: 1, check: 1 };

  function svg(name, size) {
    const d = P[name];
    if (!d) return '';
    const s = size || 22;
    const solid = SOLID[name];
    return '<svg class="ico ico-' + name + '" width="' + s + '" height="' + s + '" ' +
      'viewBox="0 0 24 24" ' +
      (solid
        ? 'fill="currentColor" stroke="none" '
        : 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ') +
      'aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  function el(name, size) {
    const box = document.createElement('span');
    box.className = 'ico-box';
    box.innerHTML = svg(name, size);
    return box.firstChild;
  }

  const Icons = { svg, el, names: Object.keys(P), has: n => !!P[n] };

  w.Icons = Icons;
  if (typeof module !== 'undefined' && module.exports) module.exports = Icons;
})(typeof window !== 'undefined' ? window : globalThis);
