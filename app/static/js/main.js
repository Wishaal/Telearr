// main.js — app bootstrap: shell, router, polling, theme.
import { h, mount, qs, api } from "./core.js";
import { icon } from "./icons.js";
import { viewDashboard, viewChannels, viewDownloads, viewActivity, viewSettings, openChannelModal, ui } from "./views.js";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", view: viewDashboard },
  { id: "channels", label: "Channels", icon: "channels", view: viewChannels },
  { id: "downloads", label: "Downloads", icon: "downloads", view: viewDownloads },
  { id: "activity", label: "Activity", icon: "activity", view: viewActivity },
  { id: "settings", label: "Settings", icon: "settings", view: viewSettings },
];
const TITLE = Object.fromEntries(NAV.map((n) => [n.id, n.label]));

let DATA = { status: null, downloads: [], channels: [] };
let active = (location.hash.replace("#/", "") || "dashboard");
if (!TITLE[active]) active = "dashboard";

// ── theme ──
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
const getTheme = () => localStorage.getItem("theme") || "auto";
function setTheme(t) { localStorage.setItem("theme", t); applyTheme(t); syncThemeBtn(); }
function cycleTheme() { const order = ["auto", "light", "dark"]; setTheme(order[(order.indexOf(getTheme()) + 1) % 3]); }
applyTheme(getTheme());
if (ui.dense) document.body.classList.add("dense");

const ctx = {
  get data() { return DATA; },
  refresh: async () => { await fetchForView(); render(); },
  rerender: () => render(),
  getTheme, setTheme,
};

// ── shell ──
function buildShell() {
  const brand = h("div", { class: "brand" }, h("span", { class: "logo", html: icon("telegram") }), h("span", {}, "Tele", h("b", {}, "arr")));
  const navBtn = (n, cls) => h("button", { class: `${cls} ${active === n.id ? "on" : ""}`, dataset: { view: n.id }, onClick: () => go(n.id) },
    h("span", { class: "ni", html: icon(n.icon) }), h("span", { class: "nl" }, n.label));
  const sidebar = h("aside", { class: "sidebar" },
    brand,
    h("nav", { class: "nav" }, ...NAV.map((n) => navBtn(n, "nav-item"))),
    h("div", { class: "side-foot" },
      h("div", { id: "tg-status", class: "tg-status" }, "…"),
      h("button", { id: "pause-toggle", class: "btn ghost block", onClick: togglePause }, "…"),
      h("a", { class: "logout", href: "/logout" }, "Sign out")));
  const topbar = h("header", { class: "topbar" },
    h("h1", { id: "view-title" }, TITLE[active]),
    h("span", { id: "tg-dot", class: "dot", title: "Telegram" }),
    h("div", { class: "topbar-actions" },
      h("button", { id: "theme-toggle", class: "btn ghost icon", title: "Theme", "aria-label": "Toggle theme (auto/light/dark)", onClick: cycleTheme }, h("span", { html: icon("sun") })),
      h("div", { id: "ctx-actions" })));
  const bottomNav = h("nav", { class: "bottom-nav" }, ...NAV.map((n) => navBtn(n, "bnav-item")));
  mount(qs("#app"),
    sidebar,
    h("main", { class: "main" }, topbar, h("div", { class: "view", id: "view-root" })),
    bottomNav);
}

function syncNav() {
  document.querySelectorAll(".nav-item,.bnav-item").forEach((b) => b.classList.toggle("on", b.dataset.view === active));
  const t = qs("#view-title"); if (t) t.textContent = TITLE[active];
  const ca = qs("#ctx-actions");
  if (ca) mount(ca, active === "channels"
    ? h("button", { class: "btn primary", onClick: () => openChannelModal(ctx, null) }, h("span", { html: icon("plus") }), "Add channel")
    : []);
}
function syncThemeBtn() { const b = qs("#theme-toggle"); if (b) mount(b, h("span", { html: icon(getTheme() === "dark" ? "moon" : getTheme() === "light" ? "sun" : "wifi") })); }

function updateShell() {
  const s = DATA.status; if (!s) return;
  const dot = qs("#tg-dot"); if (dot) { dot.className = "dot " + (s.authorized ? "ok" : "bad"); dot.title = s.authorized ? "Telegram connected" : "Telegram offline"; }
  const tg = qs("#tg-status"); if (tg) mount(tg, h("span", { class: "dot " + (s.authorized ? "ok" : "bad") }), s.authorized ? "Telegram connected" : "Telegram offline");
  const pt = qs("#pause-toggle"); if (pt) mount(pt, h("span", { html: icon(s.paused ? "play" : "pause") }), s.paused ? "Resume downloads" : "Pause downloads");
}

async function togglePause() {
  const s = DATA.status;
  const r = await api(s && s.paused ? "/api/queue/resume" : "/api/queue/pause", { method: "POST" });
  if (r) { await fetchForView(); updateShell(); render(); }
}

// ── data + render ──
async function fetchForView() {
  const [status] = await Promise.all([api("/api/status")]);
  if (status) DATA.status = status;
  if (active === "dashboard" || active === "downloads") {
    const dl = await api("/api/downloads?limit=1000"); if (dl) { DATA.downloads = dl; const ids = new Set(dl.map((d) => d.id)); [...ui.sel].forEach((i) => { if (!ids.has(i)) ui.sel.delete(i); }); }
  }
  if (active === "channels") { const ch = await api("/api/channels"); if (ch) DATA.channels = ch; }
  updateShell();
}

function render() {
  const root = qs("#view-root"); if (!root) return;
  const a = document.activeElement; const keepId = a && a.id; const pos = a && a.selectionStart;
  mount(root, NAV.find((n) => n.id === active).view(ctx));
  if (keepId) { const n = root.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(keepId) : keepId)); if (n) { n.focus(); try { n.selectionStart = n.selectionEnd = pos; } catch {} } }
  syncNav(); syncThemeBtn();
}

async function go(name) {
  active = TITLE[name] ? name : "dashboard";
  location.hash = "#/" + active;
  ui.sel.clear();
  syncNav();
  await fetchForView();
  render();
}
window.addEventListener("hashchange", () => { const n = location.hash.replace("#/", ""); if (TITLE[n] && n !== active) go(n); });

// ── boot ──
buildShell();
go(active);
setInterval(async () => {
  await fetchForView();
  if (active === "dashboard" || active === "downloads") render();
}, 2500);
