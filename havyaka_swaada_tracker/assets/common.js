/**
 * assets/common.js — Havyaka Swaada Shared Utilities
 * All pages load this file. Access via the global `HS` object.
 */

const HS = (() => {

  /* ══════════════════════════════════════
     CONFIG
  ══════════════════════════════════════ */
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzQb9h4EkXB2SN2QeaIwtZzCGAemP1sSSP2dSFpqP7lUQ0YK_FjAwuW5BR-P8F6meg/exec';
  const LOGO_PATH  = 'assets/Havyaka_Swaada_English_Logo.png';
  const APP_NAME   = 'Havyaka Swaada';

  /* ══════════════════════════════════════
     SCRIPT URL
  ══════════════════════════════════════ */
  function getScriptUrl() {
    return SCRIPT_URL || localStorage.getItem('hs_script_url') || '';
  }

  /* ══════════════════════════════════════
     NAVIGATION
  ══════════════════════════════════════ */
  function navigate(page, params = {}) {
    const query = new URLSearchParams(params).toString();
    window.location.href = query ? `${page}?${query}` : page;
  }

  function back() { window.history.back(); }

  function getParam(key) {
    return new URLSearchParams(window.location.search).get(key);
  }

  /* ══════════════════════════════════════
     CURRENT MELA  (localStorage — survives phone lock & tab suspend)
  ══════════════════════════════════════ */
  function getCurrentMela() {
    try { return JSON.parse(localStorage.getItem('hs_current_mela') || 'null'); }
    catch { return null; }
  }

  function setCurrentMela(mela) {
    localStorage.setItem('hs_current_mela', JSON.stringify(mela));
  }

  /* ══════════════════════════════════════
     TOAST
  ══════════════════════════════════════ */
  let _toastTimer;
  function toast(msg, type = '', noNav = false) {
    let el = document.getElementById('hs-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hs-toast';
      document.body.appendChild(el);
    }
    el.className = 'hs-toast' + (type ? ' ' + type : '') + (noNav ? ' no-nav' : '');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ══════════════════════════════════════
     LOADING OVERLAY
  ══════════════════════════════════════ */
  function loading(show, msg = 'Loading…') {
    let el = document.getElementById('hs-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hs-loading';
      el.className = 'hs-loading';
      el.innerHTML = `<div class="hs-spinner"></div><p class="hs-loading-text" id="hs-loading-msg"></p>`;
      document.body.appendChild(el);
    }
    const msgEl = document.getElementById('hs-loading-msg');
    if (msgEl) msgEl.textContent = msg;
    el.classList.toggle('show', show);
  }

  /* ══════════════════════════════════════
     HEADER  (inner pages)
  ══════════════════════════════════════ */
  function renderHeader({ title, subtitle = '', showBack = false, showMenu = false, rightIcon = null, rightFn = null }) {
    const el = document.getElementById('hs-header');
    if (!el) return;

    const leftBtn = showBack
      ? `<button class="hs-header-btn" onclick="HS.back()" aria-label="Back">&#8592;</button>`
      : showMenu
        ? `<button class="hs-header-btn" id="menuToggle" onclick="HS.toggleSidebar()" aria-label="Menu">&#9776;</button>`
        : `<div style="width:40px"></div>`;

    const rightBtn = rightIcon && rightFn
      ? `<button class="hs-header-btn" onclick="${rightFn}" aria-label="Action">${rightIcon}</button>`
      : `<div style="width:40px"></div>`;

    el.innerHTML = `
      ${leftBtn}
      <img src="${LOGO_PATH}" class="hs-header-logo" alt="${APP_NAME}" />
      <div class="hs-header-center">
        <div class="hs-header-title">${title}</div>
        ${subtitle ? `<div class="hs-header-subtitle">${subtitle}</div>` : ''}
      </div>
      ${rightBtn}
    `;
  }

  /* ══════════════════════════════════════
     SIDEBAR
  ══════════════════════════════════════ */
  const SIDEBAR_NAV = [
    { id: 'log',       icon: '📝', label: 'Log Sale',    href: 'log.html' },
    { id: 'dashboard', icon: '📊', label: 'Dashboard',   href: 'dashboard.html' },
    { id: 'menu',      icon: '🍽️', label: 'Menu',        href: 'menu.html' },
    { id: 'expenses',  icon: '💸', label: 'Expenses',    href: 'expenses.html' },
    { id: 'inventory', icon: '📦', label: 'Inventory',   href: 'inventory.html' },
    { id: 'info',      icon: 'ℹ️',  label: 'Mela Info',  href: 'mela-info.html' },
  ];

  function renderSidebar(activeId = '') {
    const mela = getCurrentMela();
    const melaName = mela ? mela.name : APP_NAME;

    const navLinks = SIDEBAR_NAV.map(item => `
      <a class="hs-sidebar-link ${activeId === item.id ? 'active' : ''}" href="${item.href}">
        <span class="s-icon">${item.icon}</span>${item.label}
      </a>
    `).join('');

    const html = `
      <div class="hs-overlay" id="sidebarOverlay" onclick="HS.toggleSidebar()"></div>
      <div class="hs-sidebar" id="hs-sidebar">
        <div class="hs-sidebar-head">
          <img src="${LOGO_PATH}" class="hs-sidebar-logo" alt="${APP_NAME}" />
          <div>
            <div class="hs-sidebar-brand">${APP_NAME}</div>
            <div class="hs-sidebar-mela-name">${melaName}</div>
          </div>
        </div>
        <nav class="hs-sidebar-nav">
          ${navLinks}
          <div class="hs-sidebar-hr"></div>
          <a class="hs-sidebar-link" href="index.html">
            <span class="s-icon">🏠</span>All Melas
          </a>
        </nav>
      </div>
    `;
    document.body.insertAdjacentHTML('afterbegin', html);
  }

  function toggleSidebar() {
    document.getElementById('hs-sidebar')?.classList.toggle('open');
    document.getElementById('sidebarOverlay')?.classList.toggle('open');
  }

  /* ══════════════════════════════════════
     MODAL HELPERS
  ══════════════════════════════════════ */
  function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
  function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

  /* ══════════════════════════════════════
     CONFIRM DIALOG  (native for now)
  ══════════════════════════════════════ */
  function confirm(msg, onYes, onNo = null) {
    if (window.confirm(msg)) { onYes(); } else if (onNo) { onNo(); }
  }

  /* ══════════════════════════════════════
     DATE UTILITIES
  ══════════════════════════════════════ */
  function today() {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }

  /** YYYY-MM-DD → "22 May 2026" */
  function formatDate(d) {
    if (!d) return '';
    const s = normDate(String(d).trim());
    if (!s) return '';
    const dt = new Date(s + 'T00:00:00');
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Normalise any date representation → YYYY-MM-DD */
  function normDate(d) {
    if (!d) return '';
    const s = String(d).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return s;
    return [
      dt.getFullYear(),
      String(dt.getMonth() + 1).padStart(2, '0'),
      String(dt.getDate()).padStart(2, '0'),
    ].join('-');
  }

  /** Short label: "May 22" */
  function shortDate(d) {
    const s = normDate(d);
    if (!s) return '';
    const dt = new Date(s + 'T00:00:00');
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  /* ══════════════════════════════════════
     NUMBER FORMAT
  ══════════════════════════════════════ */
  function fmt(n) { return Number(n).toLocaleString('en-IN'); }

  /* ══════════════════════════════════════
     API  (Google Apps Script)
  ══════════════════════════════════════ */
  async function api(params) {
    const url = getScriptUrl();
    if (!url) throw new Error('Google Sheets not configured.');
    const query = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const resp = await fetch(`${url}?${query}`);
    const json = await resp.json();
    if (json.error) throw new Error(json.error);
    return json;
  }

  /* ══════════════════════════════════════
     LOCAL STORAGE HELPERS
  ══════════════════════════════════════ */
  function lsGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  function lsDel(key) { localStorage.removeItem(key); }

  /* ══════════════════════════════════════
     UNIQUE ID
  ══════════════════════════════════════ */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ══════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════ */
  return {
    // Constants
    LOGO_PATH, APP_NAME,
    // Navigation
    navigate, back, getParam,
    // Mela
    getCurrentMela, setCurrentMela,
    // UI feedback
    toast, loading,
    // Header / Sidebar
    renderHeader, renderSidebar, toggleSidebar,
    // Modals
    openModal, closeModal,
    // Dialogs
    confirm,
    // Dates
    today, formatDate, normDate, shortDate,
    // Numbers
    fmt,
    // API
    api,
    // Storage
    lsGet, lsSet, lsDel,
    // Misc
    uid,
  };
})();
