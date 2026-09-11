/* =========================================================
   小手机 · 角色数据
   —— 预设角色（薛沉 / 林砚 / 祁野）已移除。
   这里现在只保留主题色板等基建；
   所有对话角色都由用户在【制作人】里自建，
   或通过【设置 → 导入】导入角色卡。
   历史预设角色留档在 js/_preset-chars.backup.js
   ========================================================= */

const CHARS = {};


/* 主题色板 */
const THEMES = [
  { id: 'rose',   name: '玫瑰', bg1: '#2b1b3d', bg2: '#5b2a52', bg3: '#b64b6a', accent: '#ff5f8d', accent2: '#8b5cf6' },
  { id: 'ocean',  name: '深海', bg1: '#0b2233', bg2: '#123a56', bg3: '#1e6091', accent: '#38bdf8', accent2: '#6366f1' },
  { id: 'amber',  name: '暖阳', bg1: '#3a2410', bg2: '#6b3f12', bg3: '#c2751b', accent: '#fbbf24', accent2: '#f97316' },
  { id: 'mint',   name: '薄荷', bg1: '#0d2b26', bg2: '#14514a', bg3: '#1f8a72', accent: '#34d399', accent2: '#0ea5e9' },
  { id: 'violet', name: '暗夜', bg1: '#1b1230', bg2: '#3b2166', bg3: '#6d28d9', accent: '#a78bfa', accent2: '#ec4899' }
];
