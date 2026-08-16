// views.js — each view builds real DOM via h(); handlers are attached inline.
import { h, mount, api, jpost, jpatch, toast, copy, gb, fmtBytes, fmtETA, base } from "./core.js";
import { icon } from "./icons.js";

const ACTIVE = new Set(["downloading", "queued"]);

// view-local UI state (persisted where it helps)
export const ui = {
  tab: "completed",
  q: "",
  sort: localStorage.getItem("dl_sort") || "new",
  dense: localStorage.getItem("density") === "1",
  sel: new Set(),
  expanded: new Set(),
};

// ── small components ──
const card = (title, ...body) => h("section", { class: "card" },
  title && h("div", { class: "card-h" }, title), ...body);

const statusPill = (s) => h("span", { class: `pill s-${s}` }, s);

function emptyState(ic, title, sub, btnLabel, onClick) {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-ico", html: icon(ic) }),
    h("div", { class: "empty-title" }, title),
    sub ? h("div", { class: "muted small" }, sub) : null,
    btnLabel ? h("button", { class: "btn primary", onClick }, btnLabel) : null);
}

function statCard(n, label, tone = "", key = "") {
  return h("div", { class: "stat" },
    h("div", { class: `n ${tone}`, dataset: key ? { stat: key } : {} }, n),
    h("div", { class: "l" }, label));
}

function countUp(el, to) {
  if (typeof requestAnimationFrame !== "function" || typeof performance === "undefined") { el.textContent = to; return; }
  const start = performance.now(), dur = 650;
  const tick = (t) => {
    const p = Math.min(1, (t - start) / dur);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function donutSvg(disk) {
  const pct = disk && disk.total ? disk.used / disk.total : 0;
  const R = 54, C = 2 * Math.PI * R, off = C * (1 - pct), warn = pct > 0.9;
  return `<svg viewBox="0 0 140 140" class="donut" aria-hidden="true">
    <defs><linearGradient id="dgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b93ff"/><stop offset="1" stop-color="#35c46b"/></linearGradient></defs>
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="13"/>
    <circle id="donut-arc" cx="70" cy="70" r="${R}" fill="none" stroke="${warn ? "var(--err)" : "url(#dgrad)"}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 70 70)"/>
    <text id="donut-pct" x="70" y="72" text-anchor="middle" class="donut-pct">${Math.round(pct * 100)}%</text>
    <text x="70" y="92" text-anchor="middle" class="donut-sub">used</text>
  </svg>`;
}

const diskLegend = (disk) => [h("span", {}, `${fmtBytes(disk.used || 0)} used`), h("span", {}, `${fmtBytes(disk.free || 0)} free`)];

const SPEED_HIST = [];
const SPARK_SVG = '<svg viewBox="0 0 260 52" class="spark" preserveAspectRatio="none">'
  + '<defs><linearGradient id="sgrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5b93ff"/><stop offset="1" stop-color="#35c46b"/></linearGradient>'
  + '<linearGradient id="sfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b93ff" stop-opacity=".25"/><stop offset="1" stop-color="#5b93ff" stop-opacity="0"/></linearGradient></defs>'
  + '<polygon id="spark-area" fill="url(#sfill)" points=""/>'
  + '<polyline id="spark-line" fill="none" stroke="url(#sgrad)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points=""/></svg>';
function drawSpark() {
  const line = document.querySelector("#spark-line"), area = document.querySelector("#spark-area");
  if (!line || SPEED_HIST.length < 2) return;
  const w = 260, hgt = 52, max = Math.max(0.5, ...SPEED_HIST), step = w / (SPEED_HIST.length - 1);
  const pts = SPEED_HIST.map((v, i) => `${(i * step).toFixed(1)},${(hgt - (v / max) * (hgt - 6) - 3).toFixed(1)}`);
  line.setAttribute("points", pts.join(" "));
  if (area) area.setAttribute("points", `0,${hgt} ${pts.join(" ")} ${w},${hgt}`);
}

function activeCard(d, ctx) {
  const pct = Math.round((d.progress || 0) * 100), eta = fmtETA(d);
  return h("div", { class: "active-card" },
    h("div", { class: "ac-top" },
      h("span", { class: "ac-name", title: d.save_path }, base(d.save_path) || d.file_name),
      statusPill(d.status),
      h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/downloads/${d.id}/cancel`, { method: "POST" }); ctx.refresh(); } },
        h("span", { html: icon("pause") }), "Stop")),
    h("div", { class: "ac-meta" },
      `${d.channel_title || ""} · ${d.file_size ? gb(d.file_size) : "—"} · ` +
      `${d.status === "downloading" ? (d.speed_mbs || 0).toFixed(1) + " MB/s" : "waiting"}${eta ? " · " + eta : ""} · ${pct}%`),
    h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })));
}

const activeList = (downloads, ctx) => {
  const act = downloads.filter((d) => ACTIVE.has(d.status))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "downloading" ? -1 : 1));
  return act.length ? act.map((d) => activeCard(d, ctx))
    : [h("div", { class: "empty small" }, "No active downloads.")];
};

// ── Dashboard ──
export function viewDashboard(ctx) {
  const st = (ctx.data.status && ctx.data.status.stats) || {};
  const disk = (ctx.data.status && ctx.data.status.disk) || {};
  const cards = h("div", { class: "stat-cards" },
    statCard(st.channels ?? 0, "Channels", "", "channels"),
    statCard(st.downloading ?? 0, "Downloading", "accent", "downloading"),
    statCard(st.queued ?? 0, "Queued", "warn", "queued"),
    statCard(st.completed ?? 0, "Completed", "ok", "completed"),
    statCard(st.failed ?? 0, "Failed", st.failed ? "err" : "", "failed"),
    statCard(fmtBytes(st.total_size || 0), "Library", "", "lib"));
  const speed = (ctx.data.status && ctx.data.status.speed) || 0;
  const root = h("div", { class: "stack" },
    cards,
    h("div", { class: "grid-2" },
      card("Storage",
        h("div", { class: "donut-wrap", html: donutSvg(disk) }),
        h("div", { class: "meter-legend", id: "disk-legend" }, ...diskLegend(disk))),
      card("Download speed",
        h("div", { class: "spark-val", id: "spark-val" }, speed.toFixed(1) + " MB/s"),
        h("div", { class: "spark-wrap", html: SPARK_SVG }))),
    card("Active now", h("div", { class: "active-list", id: "dash-active" }, ...activeList(ctx.data.downloads, ctx))));
  setTimeout(() => {
    root.querySelectorAll("[data-stat]").forEach((el) => {
      if (el.dataset.stat === "lib") return;
      const v = parseInt(el.textContent); if (!isNaN(v)) { el.textContent = "0"; countUp(el, v); }
    });
    drawSpark();
  }, 0);
  return root;
}

// in-place dashboard refresh driven by SSE (smooth, avoids re-animating counters)
export function liveDashboard(ctx) {
  const st = (ctx.data.status && ctx.data.status.stats) || {};
  const disk = (ctx.data.status && ctx.data.status.disk) || {};
  const set = (k, v) => { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
  set("channels", st.channels ?? 0); set("downloading", st.downloading ?? 0);
  set("queued", st.queued ?? 0); set("completed", st.completed ?? 0);
  set("failed", st.failed ?? 0); set("lib", fmtBytes(st.total_size || 0));
  if (disk.total) {
    const R = 54, C = 2 * Math.PI * R, pct = disk.used / disk.total;
    const arc = document.querySelector("#donut-arc"), pctEl = document.querySelector("#donut-pct");
    if (arc) arc.setAttribute("stroke-dashoffset", (C * (1 - pct)).toFixed(1));
    if (pctEl) pctEl.textContent = Math.round(pct * 100) + "%";
    const leg = document.querySelector("#disk-legend"); if (leg) mount(leg, ...diskLegend(disk));
  }
  const da = document.querySelector("#dash-active"); if (da) mount(da, ...activeList(ctx.data.downloads, ctx));
  const speed = (ctx.data.status && ctx.data.status.speed) || 0;
  SPEED_HIST.push(speed); if (SPEED_HIST.length > 40) SPEED_HIST.shift();
  const sv = document.querySelector("#spark-val"); if (sv) sv.textContent = speed.toFixed(1) + " MB/s";
  drawSpark();
}

// ── Channels (poster library) ──
const _artCache = new Map();
function loadArt(imdb, img, poster) {
  if (!imdb) return;
  const apply = (a) => { if (a && a.poster) { img.src = a.poster; img.classList.add("loaded"); } if (a && a.backdrop) poster.dataset.backdrop = a.backdrop; poster.classList.add("art-done"); };
  if (_artCache.has(imdb)) return apply(_artCache.get(imdb));
  api(`/api/art?imdb=${encodeURIComponent(imdb)}`).then((a) => { _artCache.set(imdb, a || {}); apply(a || {}); });
}

function channelCard(c, ctx) {
  const days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const dstr = (c.weekdays || "").split(",").filter((x) => x !== "").map((i) => days[i]).join(" ");
  const img = h("img", { class: "poster-img", alt: "", loading: "lazy" });
  const poster = h("div", { class: "poster" },
    h("span", { class: "poster-fallback", html: icon("film") }), img,
    h("button", { class: `toggle ch-toggle ${c.enabled ? "on" : ""}`, title: c.enabled ? "Enabled" : "Disabled", "aria-label": "Toggle channel",
      onClick: async (e) => { e.stopPropagation(); await jpatch(`/api/channels/${c.id}`, { enabled: c.enabled ? 0 : 1 }); ctx.refresh(); } }));
  loadArt(c.imdb_id, img, poster);
  if (!c.imdb_id) poster.classList.add("art-done");
  return h("div", { class: "ch-card" }, poster,
    h("div", { class: "ch-body" },
      h("div", { class: "ch-title", title: c.imdb_title || c.title }, c.imdb_title || c.title),
      h("div", { class: "ch-meta" }, `${c.kind} · ${dstr || "—"} · ${c.poll_minutes}m`),
      h("div", { class: "ch-actions" },
        h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/channels/${c.id}/scan`, { method: "POST" }); toast("Scan started", "ok"); } }, h("span", { html: icon("scan") }), "Scan"),
        h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/channels/${c.id}/backfill`, { method: "POST" }); toast("Backfill started", "ok"); } }, "Backfill"),
        h("button", { class: "btn ghost sm icon", title: "Edit", "aria-label": "Edit channel", onClick: () => openChannelModal(ctx, c) }, h("span", { html: icon("edit") })),
        h("button", { class: "btn ghost sm icon", title: "Remove", "aria-label": "Remove channel", onClick: async () => { if (confirm("Remove this channel? Download history is kept.")) { await api(`/api/channels/${c.id}`, { method: "DELETE" }); toast("Channel removed", "ok"); ctx.refresh(); } } }, h("span", { html: icon("trash") })))));
}

export function viewChannels(ctx) {
  const rows = ctx.data.channels || [];
  if (!rows.length) return emptyState("channels", "No channels yet", "Add a Telegram channel to start grabbing episodes.", "Add channel", () => openChannelModal(ctx, null));
  return h("div", { class: "ch-grid" }, ...rows.map((c) => channelCard(c, ctx)));
}

// ── Downloads ──
const counts = (dls) => dls.reduce((c, d) => (c[d.status] = (c[d.status] || 0) + 1, c),
  { completed: 0, failed: 0, cancelled: 0, downloading: 0, queued: 0 });

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (ui.sort === "big") return (b.file_size || 0) - (a.file_size || 0);
    if (ui.sort === "name") return (base(a.save_path) || a.file_name || "").localeCompare(base(b.save_path) || b.file_name || "");
    const ta = a.finished_at || a.created_at || 0, tb = b.finished_at || b.created_at || 0;
    return ui.sort === "old" ? ta - tb : tb - ta;
  });
}
const matchQ = (d) => !ui.q || (base(d.save_path) || d.file_name || "").toLowerCase().includes(ui.q.toLowerCase())
  || (d.channel_title || "").toLowerCase().includes(ui.q.toLowerCase());

function rowsTable(rows, ctx, selectAll = true) {
  const allSel = rows.length && rows.every((d) => ui.sel.has(d.id));
  const head = h("tr", {},
    h("th", { class: "cb" }, selectAll ? h("input", {
      type: "checkbox", checked: allSel, "aria-label": "Select all",
      onChange: (e) => { rows.forEach((d) => e.target.checked ? ui.sel.add(d.id) : ui.sel.delete(d.id)); ctx.rerender(); },
    }) : null),
    ...["File", "Channel", "Size", "Status", "When", ""].map((t) => h("th", {}, t)));
  const body = rows.map((d) => h("tr", { class: ui.sel.has(d.id) ? "selrow" : "" },
    h("td", { class: "cb" }, h("input", {
      type: "checkbox", checked: ui.sel.has(d.id), "aria-label": "Select row",
      onChange: (e) => { e.target.checked ? ui.sel.add(d.id) : ui.sel.delete(d.id); ctx.rerender(); },
    })),
    h("td", { title: d.save_path }, base(d.save_path) || d.file_name),
    h("td", {}, d.channel_title || "—"),
    h("td", {}, d.file_size ? gb(d.file_size) : "—"),
    h("td", {}, statusPill(d.status)),
    h("td", { class: "muted small" }, d.finished_at ? new Date(d.finished_at * 1000).toLocaleDateString() : ""),
    h("td", { class: "actions" },
      (d.status === "failed" || d.status === "cancelled") ? h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/downloads/${d.id}/retry`, { method: "POST" }); toast("Re-queued", "ok"); ctx.refresh(); } }, "Retry") : null,
      h("button", { class: "btn ghost sm icon", title: "Delete", "aria-label": "Delete record", onClick: async () => { await api(`/api/downloads/${d.id}`, { method: "DELETE" }); ctx.refresh(); } }, h("span", { html: icon("trash") })))));
  return h("table", {}, h("thead", {}, head), h("tbody", {}, ...body));
}

function completedGrouped(dls, ctx) {
  let rows = dls.filter((d) => d.status === "completed" && matchQ(d));
  if (ui.q) return rows.length ? h("div", { class: "data-card" }, rowsTable(sortRows(rows), ctx)) : h("div", { class: "empty" }, "No matches.");
  if (!rows.length) return h("div", { class: "empty" }, "Nothing downloaded yet.");
  const groups = {};
  rows.forEach((d) => { const k = d.channel_title || "Unknown"; (groups[k] ||= []).push(d); });
  return h("div", { class: "stack" }, ...Object.keys(groups).sort().map((name) => {
    const items = sortRows(groups[name]); const size = items.reduce((s, d) => s + (d.file_size || 0), 0);
    const open = ui.expanded.has(name);
    const toggle = () => { open ? ui.expanded.delete(name) : ui.expanded.add(name); ctx.rerender(); };
    return h("div", { class: "grp" },
      h("div", {
        class: "grp-head", role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false", "aria-label": `Toggle ${name}`,
        onClick: toggle, onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } },
      },
        h("span", { class: "tw", html: icon(open ? "chevron-down" : "chevron-right") }),
        h("span", { class: "grp-name" }, name),
        h("span", { class: "grp-meta" }, `${items.length} episode${items.length > 1 ? "s" : ""} · ${gb(size)}`),
        h("button", {
          class: "btn ghost sm", onClick: async (e) => {
            e.stopPropagation();
            const ids = items.map((d) => d.id);
            if (confirm(`Remove ${ids.length} completed record(s) for ${name}? Files on disk are kept.`)) { await jpost("/api/downloads/bulk", { action: "delete", ids }); ctx.refresh(); }
          },
        }, "Clear")),
      open ? h("div", { class: "grp-body" }, rowsTable(items, ctx, false)) : null);
  }));
}

export function viewDownloads(ctx) {
  const dls = ctx.data.downloads || []; const c = counts(dls);
  const tab = (k, label) => h("button", { class: `tab ${ui.tab === k ? "on" : ""}`, onClick: () => { ui.tab = k; ctx.rerender(); } }, label, h("b", {}, c[k] || 0));
  const controls = h("div", { class: "dl-controls" },
    h("div", { class: "tabs" }, tab("completed", "Completed"), tab("failed", "Failed"), tab("cancelled", "Cancelled")),
    h("input", { id: "dl-search", type: "search", placeholder: "Filter…", value: ui.q, onInput: (e) => { ui.q = e.target.value; ctx.rerender(); } }),
    h("select", { class: "mini", title: "Sort", onChange: (e) => { ui.sort = e.target.value; localStorage.setItem("dl_sort", ui.sort); ctx.rerender(); } },
      ...[["new", "Newest"], ["old", "Oldest"], ["big", "Largest"], ["name", "Name A→Z"]].map(([v, l]) => h("option", { value: v, selected: ui.sort === v }, l))),
    h("button", { class: "btn ghost sm icon", title: "Toggle density", "aria-label": "Toggle row density", onClick: () => { ui.dense = !ui.dense; localStorage.setItem("density", ui.dense ? "1" : "0"); document.body.classList.toggle("dense", ui.dense); ctx.rerender(); } }, h("span", { html: icon("filter") })));

  // bulk bar
  const sel = dls.filter((d) => ui.sel.has(d.id));
  const bulk = h("div", { class: "bulk-bar" });
  if (ui.sel.size) {
    bulk.append(h("span", {}, h("b", {}, ui.sel.size), " selected"));
    if (sel.some((d) => d.status === "failed" || d.status === "cancelled"))
      bulk.append(h("button", { class: "btn ghost sm", onClick: async () => { await jpost("/api/downloads/bulk", { action: "retry", ids: [...ui.sel] }); ui.sel.clear(); ctx.refresh(); } }, "Retry"));
    bulk.append(h("button", { class: "btn danger sm", onClick: async () => { await jpost("/api/downloads/bulk", { action: "delete", ids: [...ui.sel] }); ui.sel.clear(); ctx.refresh(); } }, "Delete"));
    bulk.append(h("button", { class: "btn ghost sm", onClick: () => { ui.sel.clear(); ctx.rerender(); } }, "Clear selection"));
  }
  bulk.append(h("span", { class: "spacer" }));
  if (c.failed) bulk.append(h("button", { class: "btn ghost sm", onClick: async () => { const ids = dls.filter((d) => d.status === "failed").map((d) => d.id); if (confirm(`Delete ${ids.length} failed record(s)?`)) { await jpost("/api/downloads/bulk", { action: "delete", ids }); ctx.refresh(); } } }, `Clear ${c.failed} failed`));

  const body = ui.tab === "completed" ? completedGrouped(dls, ctx)
    : (() => { const rows = dls.filter((d) => d.status === ui.tab && matchQ(d)); return rows.length ? h("div", { class: "data-card" }, rowsTable(sortRows(rows), ctx)) : h("div", { class: "empty" }, "Nothing here."); })();

  return h("div", { class: "stack" },
    h("div", { class: "active-list", id: "dl-active" }, ...activeList(dls, ctx)),
    controls, bulk, body);
}

// live active-download list (used by SSE to update without rebuilding the whole view)
export const liveActive = (ctx) => activeList(ctx.data.downloads, ctx);

// ── Activity (logs) ──
export function viewActivity(ctx) {
  const pre = h("pre", { id: "logs" }, "Loading…");
  const lvlSel = h("select", { class: "mini", onChange: () => load() },
    ...[["", "All levels"], ["ERROR", "Errors"], ["WARN", "Warnings"], ["INFO", "Info"]].map(([v, l]) => h("option", { value: v }, l)));
  async function load() {
    const rows = await api("/api/logs?limit=300"); if (!rows) return;
    const lvl = lvlSel.value;
    const txt = rows.filter((l) => !lvl || l.level === lvl).reverse()
      .map((l) => `${new Date(l.ts * 1000).toLocaleString()}  ${l.level.padEnd(5)}  ${l.message}`).join("\n");
    pre.textContent = txt || "No log entries.";
  }
  load();
  return h("div", { class: "stack" }, h("div", { class: "log-toolbar" }, lvlSel), pre);
}

// ── Settings ──
export function viewSettings(ctx) {
  const root = h("div", { class: "settings-grid" }, h("div", { class: "empty" }, "Loading…"));
  (async () => {
    const data = await api("/api/settings"); if (!data) return;
    const s = data.settings, p = data.paths, arrKey = (data.arr || {}).apikey || "";
    const row = (label, input, hint) => h("div", { class: "set-row" },
      h("label", {}, label, hint && h("div", { class: "hint" }, hint)), input);
    const inp = (id, val, type = "text") => h("input", { id, value: val ?? "", type });

    const account = card("Account",
      row("Current password", inp("pw-cur", "", "password")),
      row("New password", inp("pw-new", "", "password"), "min 6 characters"),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const r = await jpost("/api/account/password", { current: root.querySelector("#pw-cur").value, new: root.querySelector("#pw-new").value }); if (r) { toast("Password changed", "ok"); root.querySelector("#pw-cur").value = ""; root.querySelector("#pw-new").value = ""; } } }, "Change password"),
        h("a", { class: "btn ghost sm", href: "/logout" }, h("span", { html: icon("logout") }), "Sign out")));

    const themeBtn = (v, l) => h("button", { class: `btn ghost sm ${ctx.getTheme() === v ? "on" : ""}`, onClick: () => { ctx.setTheme(v); ctx.rerender(); } }, l);
    const appearance = card("Appearance", row("Theme", h("div", { class: "theme-pick" }, themeBtn("auto", "Auto"), themeBtn("light", "Light"), themeBtn("dark", "Dark"))));

    const perf = card("Performance",
      row("Parallel connections", inp("set-dl_workers", s.dl_workers, "number"), "per download · too high triggers Telegram FloodWait"),
      row("Concurrent downloads", inp("set-max_concurrent", s.max_concurrent, "number")),
      row("Min free space (GB)", inp("set-min_free_gb", s.min_free_gb, "number")),
      row("Default poll (min)", inp("set-default_poll_minutes", s.default_poll_minutes, "number")),
      row("Keep per show", inp("set-history_limit_per_show", s.history_limit_per_show, "number"), "completed records to keep · 0 = all (files always kept)"),
      h("div", { class: "set-actions" }, h("button", {
        class: "btn primary sm", onClick: async () => {
          const g = (k) => root.querySelector("#set-" + k).value;
          await jpatch("/api/settings", { dl_workers: g("dl_workers"), max_concurrent: g("max_concurrent"), min_free_gb: g("min_free_gb"), default_poll_minutes: g("default_poll_minutes"), history_limit_per_show: g("history_limit_per_show") });
          toast("Performance saved", "ok");
        },
      }, "Save performance")));

    const plexOut = h("span", { class: "test-out" });
    const plex = card("Plex",
      row("Server URL", inp("set-plex_url", s.plex_url), "e.g. http://plex_local:32400"),
      row("Token" + (s.plex_token_set ? " (saved)" : ""), inp("set-plex_token", "", "password")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const f = { plex_url: root.querySelector("#set-plex_url").value }; const tk = root.querySelector("#set-plex_token").value; if (tk) f.plex_token = tk; await jpatch("/api/settings", f); toast("Plex settings saved", "ok"); } }, "Save"),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await api("/api/integrations/plex/test", { method: "POST" }); if (r) { plexOut.textContent = r.detail; plexOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, "Test"), plexOut));

    const notifyOut = h("span", { class: "test-out" });
    const notify = card("Notifications",
      row("Webhook URL", inp("set-notify_webhook", s.notify_webhook), "Discord / Slack / generic JSON"),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { await jpatch("/api/settings", { notify_webhook: root.querySelector("#set-notify_webhook").value }); toast("Webhook saved", "ok"); } }, "Save"),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await api("/api/integrations/notify/test", { method: "POST" }); if (r) { notifyOut.textContent = r.detail; notifyOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, "Test"), notifyOut));

    const tmdbOut = h("span", { class: "test-out" });
    const tmdbc = card("Artwork (TMDB)",
      h("div", { class: "muted small", style: "margin-bottom:10px" }, "Add a free TMDB API key to show poster artwork on the Channels page. Get one at themoviedb.org → Settings → API."),
      row("API key" + (s.tmdb_key_set ? " (saved)" : ""), inp("set-tmdb_key", "", "password")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const tk = root.querySelector("#set-tmdb_key").value; if (tk) await jpatch("/api/settings", { tmdb_key: tk }); toast("TMDB key saved", "ok"); } }, "Save"),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await api("/api/integrations/tmdb/test", { method: "POST" }); if (r) { tmdbOut.textContent = r.detail; tmdbOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, "Test"), tmdbOut));

    const keyInp = inp("arr-key", arrKey); keyInp.readOnly = true;
    const nzInp = inp("arr-nzb", `${location.origin}/api/newznab`); nzInp.readOnly = true;
    const arr = card("Sonarr / Radarr / Prowlarr",
      h("div", { class: "muted small", style: "margin-bottom:10px" }, "Add Telearr as a Newznab indexer and a SABnzbd download client. See docs/ARR_INTEGRATION.md."),
      row("Newznab URL", nzInp),
      row("SABnzbd host / port", (() => { const i = inp("arr-sab", `${location.hostname} : ${location.port || 8790}`); i.readOnly = true; return i; })()),
      row("API key", keyInp),
      h("div", { class: "set-actions" },
        h("button", { class: "btn ghost sm", onClick: () => copy(nzInp.value) }, h("span", { html: icon("copy") }), "Copy URL"),
        h("button", { class: "btn ghost sm", onClick: () => copy(keyInp.value) }, h("span", { html: icon("copy") }), "Copy key"),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await jpost("/api/integrations/arr/regenerate", {}); if (r) { keyInp.value = r.apikey; toast("API key regenerated", "ok"); } } }, h("span", { html: icon("refresh") }), "Regenerate key")));

    const paths = card("Library paths",
      h("div", { class: "muted small" }, h("div", {}, `TV → ${p.tv_dir}`), h("div", {}, `TV 4K → ${p.tv_dir_4k}`), h("div", {}, `Movies → ${p.movies_dir}`), h("div", {}, `Other → ${p.other_dir}`), h("div", { style: "margin-top:6px" }, "Edit via .env and rebuild.")));

    root.replaceChildren(account, appearance, perf, plex, notify, tmdbc, arr, paths);
  })();
  return root;
}

// ── Channel modal (add / edit) with IMDb picker ──
export function openChannelModal(ctx, channel) {
  const host = document.querySelector("#modal-root");
  let pick = null, imdbTimer = null;
  const chat = h("input", { placeholder: "-1001976450659 (or a bare id)", value: channel ? channel.chat_id : "", disabled: !!channel });
  const kind = h("select", {}, ...["tv", "movie", "other"].map((k) => h("option", { value: k, selected: channel && channel.kind === k }, k === "tv" ? "TV show" : k === "movie" ? "Movie" : "Other")));
  const poll = h("input", { type: "number", min: "1", value: channel ? channel.poll_minutes : 10 });
  const daysOn = channel ? (channel.weekdays || "").split(",") : ["0", "1", "2", "3", "4", "5", "6"];
  const dayBtns = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) =>
    h("button", { type: "button", class: `m-day ${daysOn.includes(String(i)) ? "on" : ""}`, dataset: { day: i }, onClick: (e) => e.target.classList.toggle("on") }, d));
  const imdbQ = h("input", { placeholder: "Search IMDb by title…", autocomplete: "off", value: channel && channel.imdb_title ? channel.imdb_title : "" });
  const results = h("div", { class: "imdb-results" });
  const picked = h("div", { class: "imdb-picked" }, channel && channel.imdb_id ? `Current: ${channel.imdb_title || ""} (${channel.imdb_id})` : "");
  imdbQ.addEventListener("input", () => {
    clearTimeout(imdbTimer); const q = imdbQ.value;
    imdbTimer = setTimeout(async () => {
      if (!q || q.length < 2) return results.replaceChildren();
      const res = await api(`/api/imdb/search?q=${encodeURIComponent(q)}`); if (!res) return;
      results.replaceChildren(...res.map((r) => h("button", {
        type: "button", class: "hit",
        onClick: () => { const yr = r.year ? ` (${r.year})` : ""; pick = { imdb_id: r.imdb_id, imdb_title: `${r.title}${yr}` }; imdbQ.value = r.title; results.replaceChildren(); picked.replaceChildren(h("span", {}, "✓ "), h("b", {}, pick.imdb_title), h("span", { class: "muted small" }, ` (${r.imdb_id})`)); },
      }, r.title, h("small", {}, ` ${r.year ? `(${r.year})` : ""} · ${r.kind || ""}`))));
    }, 350);
  });

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); };
  document.addEventListener("keydown", onKey);
  const save = async () => {
    const weekdays = dayBtns.filter((b) => b.classList.contains("on")).map((b) => b.dataset.day).join(",") || "0,1,2,3,4,5,6";
    const pm = parseInt(poll.value) || 10;
    if (channel) {
      const patch = { kind: kind.value, weekdays, poll_minutes: pm };
      if (pick) Object.assign(patch, pick);
      if (await jpatch(`/api/channels/${channel.id}`, patch)) toast("Channel updated", "ok");
    } else {
      const cid = chat.value.trim(); if (!cid) return chat.focus();
      const ch = await jpost("/api/channels", { chat_id: cid, kind: kind.value, weekdays, poll_minutes: pm });
      if (ch && ch.id && pick) await jpatch(`/api/channels/${ch.id}`, pick);
      if (ch) toast("Channel added", "ok");
    }
    close(); ctx.refresh();
  };

  const overlay = h("div", { class: "modal", onClick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h3", {}, channel ? "Edit channel" : "Add channel"),
        h("button", { class: "btn ghost icon", "aria-label": "Close", onClick: close }, h("span", { html: icon("x") }))),
      h("label", {}, "Telegram chat id", chat),
      h("label", {}, "Kind", kind),
      h("label", {}, "Scan on days"), h("div", { class: "days" }, ...dayBtns),
      h("label", {}, "Poll interval (minutes)", poll),
      h("label", {}, "IMDb match", imdbQ), results, picked,
      h("div", { class: "modal-foot" },
        h("button", { class: "btn ghost", onClick: close }, "Cancel"),
        h("button", { class: "btn primary", onClick: save }, "Save"))));
  host.replaceChildren(overlay);
  if (!channel) chat.focus();
}
