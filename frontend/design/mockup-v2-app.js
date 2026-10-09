/* Mockup v2 renderer (soft UI, water theme). Data: window.D (real detection-module output). */
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const theme = params.get("theme") ?? "light";
const screen = params.get("screen") ?? "home";
const phone = params.get("phone") === "1";
document.documentElement.dataset.theme = theme;
if (phone) document.documentElement.classList.add("phone");
if (params.get("full") === "1") document.documentElement.classList.add("phonefull");

const LINE = D.alertLine;
const ward = (id) => D.city.find((w) => w.id === id);
const zoneName = (id) => D.zoneNames[id];
const pct = (x) => Math.round(x * 100) + "%";
const fmt = (d, o = { day: "numeric", month: "short" }) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const icon = (n, cls = "") => D.icons[n].replace('class="icon"', `class="icon ${cls}"`);
const causes = ["water", "food", "p2p", "seasonal", "unknown"];
const causeLabel = { water: "Water", food: "Food", p2p: "Person to person", seasonal: "Seasonal", unknown: "Unknown" };
const topCause = (p) => causes.reduce((b, c) => (p[c] > p[b] ? c : b));
const alerts = [...D.alerts].sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score);
const openWards = new Set(alerts.map((a) => a.wardId));
const status = (id) => (openWards.has(id) || (D.probability[id] ?? 0) >= LINE ? "alert" : (D.probability[id] ?? 0) >= 0.1 ? "watch" : "calm");
const counts = { calm: 0, watch: 0, alert: 0 };
for (const w of D.city) counts[status(w.id)]++;
const statusLabel = { calm: "Calm", watch: "Watch", alert: "Alert" };
const statusIcon = { calm: "waves", watch: "eye", alert: "siren" };

const logo = (size = 48, ripple = false) => `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">
  ${ripple ? '<circle cx="24" cy="31" r="21" fill="none" stroke="var(--aqua)" stroke-width="1.5" opacity=".35"/>' : ""}
  <path d="M24 4C24 4 9 21 9 31a15 15 0 0 0 30 0C39 21 24 4 24 4Z" fill="var(--teal)"/>
  <path d="M24 9C24 9 13 22 13 31" fill="none" stroke="var(--aqua)" stroke-width="2" stroke-linecap="round" opacity=".7"/>
  <polyline points="14,32 19,32 21.5,26 25,38 28,29 30,32 34,32" fill="none" stroke="var(--on-teal)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function rail(cur) {
  const items = [["home", "house", "Home"], ["map", "map", "Map"], ["alerts", "bell", "Alerts"], ["proof", "badge-check", "Proof"], ["data", "database", "Data"]];
  return `<nav class="rail" aria-label="Main">
    <a class="rail-brand" href="#" aria-label="Outbreak Watch, home">${logo(44)}<span>Outbreak<br>Watch</span></a>
    <div class="rail-items">${items.map(([id, ic, label]) => `<a href="#" class="navbtn${cur === id ? " active" : ""}"${cur === id ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${id === "alerts" ? `<span class="count" aria-label="${alerts.length} open">${alerts.length}</span>` : ""}</a>`).join("")}</div>
    <a href="#" class="navbtn demo">${icon("sliders-horizontal")}<span>Demo</span></a>
  </nav>`;
}

function topbar(title, brand) {
  return `<header class="top">
    ${brand ? `<div class="brandbig">${logo(64, true)}<div><h1>Outbreak Watch</h1><p class="tagline">Early warning for contaminated water, Bengaluru</p></div></div>` : `<h1 class="pagetitle">${title}</h1>`}
    <div class="topright">
      <span class="soft-chip plain">${icon("clock")}${fmt(D.today, phone ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
      <span class="muted">Updated 6 s ago</span>
      <button class="switch" role="switch" aria-checked="${theme === "dark"}" aria-label="Dark theme">${icon("sun", "s-sun")}<span class="knob"></span>${icon("moon", "s-moon")}</button>
      <span class="soft-chip officer">${icon("user")}Duty officer</span>
      <a href="#" class="soft-chip phonedemo">${icon("sliders-horizontal")}Demo</a>
    </div>
  </header>
  <p class="honesty" role="note">${icon("info")}<span><b>Prototype in mock mode.</b> Health signals are simulated; rain, ward and water-zone boundaries are real.</span><a href="#">Data and sources</a></p>`;
}

function ring({ value, size, stroke, label, sub, color = "var(--gauge)", big = true }) {
  const r = (size - stroke) / 2 - 8, c = 2 * Math.PI * r, len = c * 0.75;
  const arc = (frac, col, w) => `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"
      stroke-dasharray="${len * frac} ${c}" transform="rotate(135 ${size / 2} ${size / 2})"/>`;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" aria-hidden="true">${arc(1, "var(--inset)", stroke)}${arc(value, color, stroke - 4)}</svg>
    <div class="ring-face" style="inset:${stroke + 18}px"></div>
    <div class="ring-text">${big ? `<span class="num-lg">${label}</span>` : `<span class="num-sm">${label}</span>`}${sub ? `<span class="ring-sub">${sub}</span>` : ""}</div></div>`;
}

const statusChip = (s, text) => `<span class="chip ${s}">${icon(statusIcon[s])}${text ?? statusLabel[s]}</span>`;

function home() {
  const topWatch = D.city.filter((w) => status(w.id) === "watch").map((w) => ({ id: w.id, p: D.probability[w.id] })).sort((a, b) => b.p - a.p)[0];
  const today = alerts.filter((a) => a.date === D.today);
  const calmShare = counts.calm / D.city.length;
  const rmax = Math.max(...D.rain.map((r) => r.mm));
  const P = D.proof;
  return rail("home") + `<main>${topbar("", true)}
    <div class="grid home">
      <section class="card gaugecard" aria-labelledby="g1">
        <h2 id="g1">City water health today</h2>
        <p class="muted">Share of wards calm. Relative risk from simulated health data.</p>
        ${ring({ value: calmShare, size: phone ? 200 : 340, stroke: phone ? 20 : 30, label: pct(calmShare), sub: "of wards calm" })}
        <div class="statusrow">${statusChip("calm", `Calm ${counts.calm}`)}${statusChip("watch", `Watch ${counts.watch}`)}${statusChip("alert", `Alert ${counts.alert}`)}</div>
      </section>
      <section class="card tile"><div class="tile-h">${icon("bell", "teal")}<h2>Open alerts</h2></div>
        <div class="num-md">${alerts.length}</div><p class="muted">${today.length} raised today, both in water zone NW3</p>
        <p class="newest">${statusChip("alert", "Newest")}<span><b>${ward(alerts[0].wardId).name}</b>, ${pct(alerts[0].score)} chance</span></p>
        <a class="pillbtn small" href="#">${icon("chevron-right")}View alerts</a></section>
      <section class="card tile"><div class="tile-h">${icon("eye", "teal")}<h2>Wards on watch</h2></div>
        <div class="num-md">${counts.watch}</div><p class="muted">Relative risk between 10% and the alert line</p>
        <p class="newest">${statusChip("watch", "Highest")}<span><b>${ward(topWatch.id).name}</b>, ${pct(topWatch.p)} relative risk</span></p>
        <a class="pillbtn small" href="#">${icon("chevron-right")}Open map</a></section>
      <section class="card tile"><div class="tile-h">${icon("cloud-rain", "teal")}<h2>Rain today</h2><span class="badge real">Real</span></div>
        <div class="num-md">${D.rain.at(-1).mm}<span class="unit">mm</span></div>
        <svg class="spark" viewBox="0 0 280 56" aria-label="Rain, last 14 days">${D.rain.map((r, i) => { const h = Math.max(6, (r.mm / rmax) * 48); return `<rect x="${i * 20 + 2}" y="${52 - h}" width="12" height="${h}" rx="6" fill="var(--rain)"/>`; }).join("")}</svg>
        <p class="muted">Last 14 days, Open-Meteo</p></section>
      <section class="card tile"><div class="tile-h">${icon("badge-check", "teal")}<h2>How well it works</h2></div>
        <div class="proofmini">${ring({ value: P.found, size: 112, stroke: 12, label: pct(P.found), big: false })}
          <div><p><b>${pct(P.found)}</b> of water outbreaks found</p><p class="muted">By chance: ${P.chance === null ? "not computed" : pct(P.chance)}</p></div></div>
        <p class="muted">Simulated outbreaks, Bayes, 0.25 false alarms per ward-year, ${P.seeds} seeds.</p>
        <a class="pillbtn small" href="#">${icon("chevron-right")}See the proof</a></section>
    </div></main>` + (phone ? bottomBar() : "");
}

function bottomBar() {
  const items = [["home", "house", "Home"], ["map", "map", "Map"], ["alerts", "bell", "Alerts"], ["proof", "badge-check", "Proof"], ["data", "database", "Data"]];
  return `<nav class="bottombar" aria-label="Main">${items.map(([id, ic, l]) => `<a href="#" class="navbtn${id === "home" ? " active" : ""}">${icon(ic)}<span>${l}</span></a>`).join("")}</nav>`;
}

/* Monotone cubic (Fritsch-Carlson) path through points, skipping nulls as gaps. */
function monotone(pts) {
  const segs = []; let cur = [];
  for (const p of pts) { if (p[1] === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); }
  if (cur.length) segs.push(cur);
  return segs.map((s) => {
    if (s.length < 2) return `M${s[0][0]},${s[0][1]}`;
    const n = s.length, d = [], m = [];
    for (let i = 0; i < n - 1; i++) d.push((s[i + 1][1] - s[i][1]) / (s[i + 1][0] - s[i][0]));
    m.push(d[0]); for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2); m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    let path = `M${s[0][0]},${s[0][1]}`;
    for (let i = 0; i < n - 1; i++) { const dx = (s[i + 1][0] - s[i][0]) / 3; path += `C${s[i][0] + dx},${s[i][1] + m[i] * dx} ${s[i + 1][0] - dx},${s[i + 1][1] - m[i + 1] * dx} ${s[i + 1][0]},${s[i + 1][1]}`; }
    return path;
  });
}

function chart(series, id, W) {
  const H = 150, pl = 8, pr = 8, pt = 12, pb = 30;
  const max = Math.max(...series.flatMap((d) => [d.count ?? 0, d.normal ?? 0])) * 1.15;
  const x = (i) => pl + (i * (W - pl - pr)) / (series.length - 1);
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  // Line = 3-day trailing average of the reported counts (labelled); every daily count is still drawn as a dot.
  const avg = series.map((d, i) => { if (d.count === null) return null; const w = series.slice(Math.max(0, i - 2), i + 1).map((q) => q.count).filter((v) => v !== null); return w.reduce((a, b) => a + b, 0) / w.length; });
  const countSegs = monotone(series.map((d, i) => [x(i), avg[i] === null ? null : y(avg[i])]));
  const dots = series.map((d, i) => d.count === null ? "" : `<circle cx="${x(i)}" cy="${y(d.count)}" r="2.6" class="daydot"/>`).join("");
  const normal = monotone(series.map((d, i) => [x(i), d.normal === null ? null : y(d.normal)]))[0];
  const areas = countSegs.map((p) => { const nums = p.match(/-?[\d.]+/g).map(Number); const x0 = nums[0], x1 = nums[nums.length - 2]; return `${p}L${x1},${H - pb}L${x0},${H - pb}Z`; });
  const ax = x(series.length - 1);
  const labels = series.map((d, i) => (i % 14 === 0 || i === series.length - 1) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"}" class="axis">${fmt(d.date)}</text>` : "").join("");
  return `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${id}, last 8 weeks, count against normal for the weekday">
    <defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--line)" stop-opacity=".38"/><stop offset="1" stop-color="var(--line)" stop-opacity="0"/></linearGradient>
    <linearGradient id="glow-${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--aqua)" stop-opacity="0"/><stop offset=".5" stop-color="var(--aqua)" stop-opacity=".35"/><stop offset="1" stop-color="var(--aqua)" stop-opacity="0"/></linearGradient></defs>
    <rect x="${ax - 22}" y="${pt - 4}" width="44" height="${H - pt - pb + 4}" fill="url(#glow-${id})" rx="22"/>
    <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" class="baseline"/>
    ${areas.map((a) => `<path d="${a}" fill="url(#g-${id})"/>`).join("")}
    <path d="${normal}" fill="none" class="normal"/>
    ${dots}${countSegs.map((p) => `<path d="${p}" fill="none" class="countline"/>`).join("")}
    ${labels}</svg>`;
}

function alertsPage() {
  const a = alerts.find((x) => x.wardId === 39);
  const w = ward(39);
  const S = D.series39;
  const name = { complaint: "Complaints", pharmacy: "Pharmacy sales", hospital: "Hospital visits" };
  const lastSeen = (sig) => [...S[sig]].reverse().find((d) => d.count !== null);
  const notYet = (sig) => S[sig].filter((d) => d.count === null).map((d) => fmt(d.date));
  const late = (sig) => S[sig].filter((d) => d.count !== null && d.reportedOn > d.date).slice(-1)[0];
  const zoneWards = D.city.filter((x) => x.zoneId === 14).map((x) => x.id);
  const zp = D.map.wardPaths.filter((p) => zoneWards.includes(p.id) || zoneWards.some((z) => ward(z).neighbours.includes(p.id)));
  const nums = zp.flatMap((p) => p.d.match(/-?[\d.]+,-?[\d.]+/g).map((s) => s.split(",").map(Number)));
  const xs = nums.map((q) => q[0]), ys = nums.map((q) => q[1]);
  const vb = [Math.min(...xs) - 8, Math.min(...ys) - 8, Math.max(...xs) - Math.min(...xs) + 16, Math.max(...ys) - Math.min(...ys) + 16].join(" ");
  const rmax = Math.max(...D.rain.map((r) => r.mm));
  const fill = { calm: "var(--map-calm)", watch: "var(--map-watch)", alert: "var(--map-alert)" };
  const tc = topCause(a.causeProbs);
  const why = a.causeEvidence.slice(0, -1);
  return rail("alerts") + `<main>${topbar("Alerts", false)}
    <div class="filters" role="group" aria-label="Filter alerts">
      <button class="fchip pressed">${icon("siren")}Open ${alerts.length}</button><button class="fchip">${icon("check")}Acknowledged 0</button><button class="fchip">${icon("circle-check")}Resolved 0</button>
      <span class="sep"></span><button class="fchip pressed">All causes</button>${["water", "food", "p2p", "seasonal", "unknown"].map((c) => `<button class="fchip"><span class="dot" style="background:var(--c-${c})"></span>${causeLabel[c]}</button>`).join("")}
    </div>
    <div class="grid alerts">
      <ul class="alist" aria-label="Open alerts, newest first">${alerts.map((x) => { const ww = ward(x.wardId); const c = topCause(x.causeProbs); const sel = x.wardId === 39; return `<li><a href="#" class="acard${sel ? " selected" : ""}"${sel ? ' aria-current="true"' : ""}>
        ${ring({ value: x.score, size: 76, stroke: 9, label: pct(x.score), big: false, color: "var(--c-alert-ring)" })}
        <div class="acard-body"><div class="lead">${ww.name}</div><div class="muted">Ward ${ww.id}${ww.zoneId ? `, zone ${zoneName(ww.zoneId)}` : ", no water zone"}, ${fmt(x.date)}</div>
        <span class="hintchip"><span class="dot" style="background:var(--c-${c})"></span>Triage hint: ${causeLabel[c]} ${pct(x.causeProbs[c])}</span></div></a></li>`; }).join("")}</ul>
      <section class="card detail" aria-labelledby="dh">
        <div class="dtop">
          <div class="dtitle">${statusChip("alert", "Open alert")}<h2 id="dh" class="h1">${w.name}</h2>
            <p class="muted">Ward ${w.id}, water zone NW3 (zone 14), suspected. Raised ${fmt(a.date, { day: "numeric", month: "long", year: "numeric" })} by the daily Bayes detector run.</p>
            <div class="actions"><button class="pillbtn primary">${icon("check")}Acknowledge</button><button class="pillbtn">${icon("circle-check")}Resolve</button><button class="pillbtn">${icon("message-square-plus")}Add note</button></div></div>
          ${ring({ value: a.score, size: 232, stroke: 22, label: pct(a.score), sub: "chance of an outbreak", color: "var(--c-alert-ring)" })}
        </div>
        <section class="sub" aria-labelledby="sigh"><div class="sub-h"><h3 id="sigh">Signals, last 8 weeks</h3>
          <span class="legend"><span class="lg-dot"></span>Daily count<span class="lg-line"></span>3-day average<span class="lg-dash"></span>Normal for that weekday<span class="lg-glow"></span>Alert day</span></div>
          ${["complaint", "pharmacy", "hospital"].map((sig) => { const ls = lastSeen(sig); const nl = notYet(sig); const lt = late(sig); return `<div class="sig">
            <div class="sig-h"><b>${name[sig]}</b><span class="badge sim">Simulated</span><span class="muted right">Latest ${ls.count} on ${fmt(ls.date)}, normal ${ls.normal}</span></div>
            ${chart(S[sig], sig, 1006)}
            ${nl.length || lt ? `<p class="late">${icon("clock")}${nl.length ? `Not reported yet: ${nl.join(", ")}.` : ""} ${lt ? `The ${fmt(lt.date)} count arrived on ${fmt(lt.reportedOn)}.` : ""}</p>` : ""}</div>`; }).join("")}
        </section>
        <div class="two">
          <section class="sub inset-card" aria-labelledby="ch"><div class="sub-h"><h3 id="ch">Likely cause</h3><span class="chip hint">${icon("info")}Triage hint, not a diagnosis</span></div>
            <div class="cbars">${causes.slice().sort((p, q) => a.causeProbs[q] - a.causeProbs[p]).map((c) => `<div class="cbar"><span class="cname"><span class="dot" style="background:var(--c-${c})"></span>${causeLabel[c]}</span><span class="track"><span style="width:${Math.max(3, a.causeProbs[c] * 100)}%;background:var(--c-${c})"></span></span><span class="cval">${pct(a.causeProbs[c])}</span></div>`).join("")}</div>
            <ul class="lines">${why.map((e) => `<li>${cap(e)}</li>`).join("")}</ul>
            <p class="muted">Most likely ${causeLabel[tc].toLowerCase()} (${pct(a.causeProbs[tc])}). An officer must confirm the cause.</p></section>
          <div class="stack">
          <section class="sub inset-card" aria-labelledby="eh"><div class="sub-h"><h3 id="eh">Why the detector alerted</h3></div>
            <ul class="lines big">${a.evidence.map((e) => `<li>${cap(e)}</li>`).join("")}</ul></section>
          <section class="sub inset-card" aria-labelledby="ah"><div class="sub-h"><h3 id="ah">Activity</h3></div>
            <ol class="timeline"><li><span class="tdot">${icon("siren")}</span><div><b>Raised</b> by the daily detector run<div class="muted">${fmt(a.date, { day: "numeric", month: "long", year: "numeric" })}</div></div></li>
              <li><span class="tdot">${icon("message-square-plus")}</span><div class="muted">No notes yet. Use Add note to record what you checked.</div></li></ol></section>
          </div>
        </div>
        <div class="two">
          <section class="sub inset-card" aria-labelledby="zh"><div class="sub-h"><h3 id="zh">Suspected zone NW3</h3><span class="muted right">Zone 14, 6 wards, 2 alerting</span></div>
            <svg class="minimap" viewBox="${vb}" role="img" aria-label="Map of water zone NW3"><defs><filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>
              ${zp.map((p) => `<path d="${p.d}" fill="${zoneWards.includes(p.id) ? fill[status(p.id)] : "var(--map-out)"}" stroke="var(--map-line)" stroke-width="1"/>`).join("")}
              ${D.map.zonePaths.filter((z) => z.id === 14).map((z) => `<path d="${z.d}" fill="none" stroke="var(--aqua)" stroke-width="7" opacity=".55" filter="url(#gl)"/><path d="${z.d}" fill="none" stroke="var(--teal)" stroke-width="2.5"/>`).join("")}
              ${zp.filter((p) => openWards.has(p.id)).map((p) => { const c = ward(p.id).centroid; const n = p.d.match(/-?[\d.]+,-?[\d.]+/g).map((s) => s.split(",").map(Number)); const mx = n.reduce((s, q) => s + q[0], 0) / n.length, my = n.reduce((s, q) => s + q[1], 0) / n.length; return `<path d="${p.d}" fill="none" stroke="var(--alert-outline)" stroke-width="2.5"/><circle cx="${mx}" cy="${my}" r="5" fill="var(--alert-outline)" stroke="var(--bg)" stroke-width="2"/>`; }).join("")}
            </svg></section>
          <section class="sub inset-card" aria-labelledby="rh"><div class="sub-h"><h3 id="rh">Rain, last 14 days</h3><span class="badge real">Real</span></div>
            <svg class="rainplot" viewBox="0 0 420 140" role="img" aria-label="Daily rain, last 14 days">${D.rain.map((r, i) => { const h = Math.max(10, (r.mm / rmax) * 92); return `<rect x="${i * 30 + 5}" y="${106 - h}" width="20" height="${h}" rx="10" fill="var(--rain)"/>${i % 4 === 1 || i === 13 ? `<text x="${i * 30 + 15}" y="132" text-anchor="${i === 13 ? "end" : "middle"}" class="axis">${fmt(r.date)}</text>` : ""}`; }).join("")}</svg>
            <p class="muted">Highest ${rmax} mm on ${fmt(D.rain.find((r) => r.mm === rmax).date)}. No day reached moderate rain (15.6 mm).</p></section>
        </div>
      </section>
    </div></main>`;
}

document.body.innerHTML = `<div class="app">${screen === "alerts" ? alertsPage() : home()}</div>`;
