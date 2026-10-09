// Builds design/mockups.html from design/mockup-data.json (real detection-module output).
// Usage: node build-mockups.mjs && node shoot.mjs
import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("./mockup-data.json", import.meta.url), "utf8"));
const backtest = JSON.parse(readFileSync(new URL("../seed/backtest.json", import.meta.url), "utf8"));
const chance = JSON.parse(readFileSync(new URL("../seed/chance.json", import.meta.url), "utf8"));
const icon = (name) => readFileSync(new URL(`./node_modules/lucide-static/icons/${name}.svg`, import.meta.url), "utf8")
  .replace(/<!--.*?-->/gs, "").replace(/\n/g, "").replace(/width="24"/, 'width="20"').replace(/height="24"/, 'height="20"')
  .replace(/stroke-width="2"/, 'stroke-width="1.75"').replace("<svg", '<svg aria-hidden="true" class="icon"');
const icons = Object.fromEntries(["droplets", "sun", "moon", "info", "circle-dot", "triangle-alert", "siren", "chevron-down",
  "check", "message-square-plus", "cloud-rain", "user", "clock", "layers", "circle-check", "refresh-cw"].map((n) => [n, icon(n)]));

// Only what the page needs.
const proof = {
  chance: chance.summary.filter((r) => r.budget === 0.25 && r.difficulty === "realistic"),
  perType: backtest.summary.filter((r) => r.budget === 0.25 && r.difficulty === "realistic" && r.subset === "all"),
  flags025: backtest.fusionDoesNotHelp.filter((f) => f.budget === 0.25).length,
  seeds: backtest.seeds.length, chanceSeeds: chance.seeds,
};
const payload = JSON.stringify({ ...data, proof, icons });

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Outbreak Watch mockups</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --canvas:#F2F4F3;--surface:#FFFFFF;--sunken:#E9EDEC;--ink:#172026;--muted:#4D5A61;--hairline:#D9DFE1;
  --accent:#00558A;--accent-ink:#FFFFFF;--accent-soft:#E3EEF6;--warn-bg:#FFF4DA;--warn-ink:#7A4A00;
  --shadow:0 1px 2px rgb(23 32 38 / .06);
  --risk-watch:#FDD27A;--risk-line:#F08A2C;--risk-alert:#8C2D04;--risk-quiet:#FFFFFF;
  --c-water:#0072B2;--c-food:#D55E00;--c-p2p:#CC79A7;--c-seasonal:#009E73;--c-unknown:#7A868C;
  --zone-line:#5E6B72;--ward-line:#C3CCD0;
  --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s7:48px;--s8:64px;
  --r-chip:4px;--r-ctl:6px;--r-card:10px;
}
[data-theme=dark]{
  --canvas:#0E1316;--surface:#151C20;--sunken:#1B2328;--ink:#E7ECEE;--muted:#A3B0B6;--hairline:#2A353B;
  --accent:#6CB6E6;--accent-ink:#0E1316;--accent-soft:#16303F;--warn-bg:#2B2213;--warn-ink:#F2C46D;
  --shadow:none;--risk-alert:#C4410F;--risk-quiet:#182024;--zone-line:#8A979D;--ward-line:#34424A;
  --c-water:#3A9AD9;--c-food:#E8773A;--c-p2p:#D98FB8;--c-seasonal:#2BB58C;--c-unknown:#8E9AA0;
}
*{box-sizing:border-box;margin:0}
body{background:var(--canvas);color:var(--ink);font:400 16px/24px Geist,system-ui,sans-serif;font-feature-settings:"tnum" 1;-webkit-font-smoothing:antialiased}
.icon{flex:none;display:block}
a{color:var(--accent);text-underline-offset:3px}
button{font:inherit;cursor:pointer}
.screen{display:none;min-height:1080px}
.screen.on{display:block}
/* shell */
.topbar{height:56px;background:var(--surface);border-bottom:1px solid var(--hairline);display:flex;align-items:center;padding:0 var(--s6);gap:var(--s6)}
.brand{display:flex;align-items:center;gap:var(--s2);font-weight:600;font-size:18px;color:var(--ink)}
.brand .icon{color:var(--accent)}
.nav{display:flex;gap:var(--s5);height:100%}
.nav a{display:flex;align-items:center;height:100%;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;padding-top:2px}
.nav a.cur{color:var(--ink);border-bottom-color:var(--accent);font-weight:500}
.topright{margin-left:auto;display:flex;align-items:center;gap:var(--s5);color:var(--muted);font-size:15px}
.live{display:flex;align-items:center;gap:var(--s2)}

.iconbtn{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--hairline);border-radius:var(--r-ctl);background:var(--surface);color:var(--ink)}
.who{display:flex;align-items:center;gap:var(--s2);color:var(--ink)}
.banner{height:40px;background:var(--warn-bg);color:var(--warn-ink);display:flex;align-items:center;gap:var(--s2);padding:0 var(--s6);font-size:15px;border-bottom:1px solid var(--hairline)}
.banner a{color:inherit;font-weight:500}
main{padding:var(--s5) var(--s6);display:grid;grid-template-columns:repeat(12,1fr);gap:var(--s5)}
.card{background:var(--surface);border:1px solid var(--hairline);border-radius:var(--r-card);box-shadow:var(--shadow);min-width:0}
.card-h{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s4);padding:var(--s4) var(--s5);border-bottom:1px solid var(--hairline)}
.card-h h2,.card-h h3{font-size:18px;line-height:26px;font-weight:600}
.meta{color:var(--muted);font-size:15px;line-height:22px}
.badge{display:inline-flex;align-items:center;gap:var(--s1);height:24px;padding:0 var(--s2);border-radius:var(--r-chip);font-size:15px;line-height:22px;border:1px solid var(--hairline);color:var(--muted);white-space:nowrap}
.badge.real{color:var(--c-seasonal);border-color:currentColor}
.badge.sim{color:var(--muted)}
.badge.hint{color:var(--muted);background:var(--sunken);border-color:transparent}
/* overview */
#overview main{grid-template-rows:752px 160px}
.map{grid-column:1/7;grid-row:1;display:flex;flex-direction:column}
.mapwrap{position:relative;flex:1;background:var(--sunken);overflow:hidden}
.mapwrap svg.citymap{position:absolute;inset:var(--s4) var(--s4) var(--s4) var(--s4);width:calc(100% - 32px);height:calc(100% - 32px)}
.ward{stroke:var(--ward-line);stroke-width:.7}
.zone{fill:none;stroke:var(--zone-line);stroke-width:1.2;stroke-dasharray:5 4}
.suspect{fill:none;stroke:var(--accent);stroke-width:3.2}
.ward.alert{stroke:var(--ink);stroke-width:1.6}
.legend{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s5);padding:var(--s3) var(--s5);border-top:1px solid var(--hairline);font-size:15px;line-height:22px}
.legend .row{display:flex;align-items:center;gap:var(--s2)}
.sw{width:16px;height:16px;border-radius:3px;border:1px solid var(--hairline);flex:none}
.attrib{position:absolute;right:var(--s2);bottom:var(--s2);font-size:15px;color:var(--muted);background:var(--surface);padding:0 var(--s2);border-radius:var(--r-chip)}
.tip{position:absolute;background:var(--surface);border:1px solid var(--hairline);border-radius:var(--r-ctl);box-shadow:0 4px 12px rgb(0 0 0 / .12);padding:var(--s3) var(--s4);width:280px;font-size:15px;line-height:22px}
.tip b{display:block;font-size:16px;font-weight:600}
.zonelabel{position:absolute;background:var(--accent);color:var(--accent-ink);font-size:15px;font-weight:500;padding:2px var(--s2);border-radius:var(--r-chip)}
.kpis{grid-column:7/9;grid-row:1;display:grid;grid-template-rows:repeat(4,1fr);gap:var(--s5)}
.kpi{padding:var(--s4) var(--s5);display:flex;flex-direction:column;justify-content:space-between}
.fig{font-size:40px;line-height:44px;font-weight:600;letter-spacing:-.01em}
.fig small{font-size:18px;font-weight:500;color:var(--muted);letter-spacing:0;margin-left:var(--s1)}
.kpi .lab{font-weight:500}.kpi .grp{display:grid;gap:var(--s1)}
.queue{grid-column:9/13;grid-row:1/3;display:flex;flex-direction:column;overflow:hidden}
.filters{display:flex;gap:var(--s3);padding:var(--s3) var(--s5);border-bottom:1px solid var(--hairline);align-items:center}
.seg{display:flex;border:1px solid var(--hairline);border-radius:var(--r-ctl);overflow:hidden}
.seg button{border:0;background:var(--surface);color:var(--muted);padding:0 var(--s3);height:36px;font-size:15px;border-right:1px solid var(--hairline)}
.seg button:last-child{border-right:0}
.seg button.cur{background:var(--accent-soft);color:var(--ink);font-weight:500}
.select{height:36px;display:flex;align-items:center;gap:var(--s2);padding:0 var(--s3);border:1px solid var(--hairline);border-radius:var(--r-ctl);color:var(--ink);font-size:15px;margin-left:auto}
.qlist{list-style:none;padding:0;overflow:hidden}
.qitem{display:grid;grid-template-columns:4px 1fr auto;gap:var(--s4);padding:var(--s3) var(--s5) var(--s3) 0;border-bottom:1px solid var(--hairline)}
.qitem .bar{background:var(--risk-alert);border-radius:0 2px 2px 0}
.qitem.sel{background:var(--accent-soft)}
.qitem .name{font-size:18px;line-height:26px;font-weight:500}
.qscore{text-align:right;align-self:start}
.qitem .pct{font-size:22px;line-height:28px;font-weight:600}
.cause{display:inline-flex;align-items:center;gap:var(--s2);font-size:15px;color:var(--muted)}
.dot{width:10px;height:10px;border-radius:2px;flex:none}
.proof{grid-column:1/9;grid-row:2;display:grid;grid-template-columns:360px 1fr 1fr 1fr;align-items:stretch}
.proof .intro{padding:var(--s4) var(--s5);border-right:1px solid var(--hairline);display:flex;flex-direction:column;justify-content:space-between}
.proof .intro h2{font-size:18px;font-weight:600}
.pm{padding:var(--s4) var(--s5);border-right:1px solid var(--hairline);display:flex;flex-direction:column;justify-content:space-between}
.pm:last-child{border-right:0}
.pm .vs{gap:var(--s3)}
.vs{display:grid;gap:var(--s1)}
.track{height:8px;background:var(--sunken);border-radius:4px;position:relative}.vrow{display:grid;grid-template-columns:84px 1fr 44px;gap:var(--s2);align-items:center;font-size:15px;color:var(--muted)}.vrow span:last-child{text-align:right;color:var(--ink)}
.track i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}
/* detail */
#detail main{grid-template-rows:auto auto}
.dhead{grid-column:1/13;display:grid;grid-template-columns:1fr auto auto;gap:var(--s6);align-items:center;padding:var(--s5)}
.crumb{color:var(--muted);font-size:15px;margin-bottom:var(--s2)}
.crumb a{color:var(--accent)}
.dhead h1{font-size:28px;line-height:34px;font-weight:600;letter-spacing:-.01em}
.score{text-align:right}
.score .fig{font-size:56px;line-height:60px}
.status{display:inline-flex;align-items:center;gap:var(--s2);height:28px;padding:0 var(--s3);border-radius:var(--r-chip);background:var(--risk-alert);color:#fff;font-weight:500;font-size:15px}
.actions{display:flex;gap:var(--s3);align-items:center}
.btn{height:40px;display:inline-flex;align-items:center;gap:var(--s2);padding:0 var(--s4);border-radius:var(--r-ctl);border:1px solid var(--hairline);background:var(--surface);color:var(--ink);font-weight:500;font-size:16px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.left{grid-column:1/9;display:grid;gap:var(--s5);align-content:start}
.right{grid-column:9/13;display:grid;gap:var(--s5);align-content:start}
.chart{padding:var(--s4) var(--s5);border-bottom:1px solid var(--hairline)}
.chart:last-child{border-bottom:0}
.chart-h{display:flex;align-items:center;gap:var(--s3);margin-bottom:var(--s2)}
.chart-h b{font-weight:600}
.chart-h .meta{margin-left:auto}
.chart svg.plot{display:block;width:100%;height:auto}
.late{font-size:15px;color:var(--muted);margin-top:var(--s2);display:flex;gap:var(--s2);align-items:center}
.ev{list-style:none;padding:var(--s2) var(--s5) var(--s4)}
.ev li{padding:var(--s2) 0;border-bottom:1px solid var(--hairline);display:flex;gap:var(--s3)}
.ev li:last-child{border-bottom:0}
.causebars{padding:var(--s4) var(--s5);display:grid;gap:var(--s3)}
.cb{display:grid;grid-template-columns:150px 1fr 48px;gap:var(--s3);align-items:center}
.cb .track{height:12px}
.cb .v{text-align:right;font-weight:500}
.why{list-style:none;padding:0 var(--s5) var(--s4);display:grid;gap:var(--s2);font-size:15px;line-height:22px;color:var(--muted)}
.mini{padding:var(--s4) var(--s5)}
.mini svg{width:100%;height:200px;display:block}
.rain{padding:var(--s4) var(--s5)}
.rain svg.plot{width:100%;height:auto;display:block}
.tl{list-style:none;padding:var(--s4) var(--s5);display:grid;gap:var(--s3)}
.tl li{display:grid;grid-template-columns:20px 1fr;gap:var(--s3)}
</style>
</head>
<body>
<div id="overview" class="screen"></div>
<div id="detail" class="screen"></div>
<script>
const D = ${payload};
const $ = (s, el = document) => el.querySelector(s);
const ward = (id) => D.city.find((w) => w.id === id);
const zoneName = (id) => D.zoneNames[id];
const fmtDate = (d, opts = { day: "numeric", month: "short" }) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
const pct = (x) => Math.round(x * 100) + "%";
const LINE = 0.7152527510491986;
const causeOrder = ["water", "food", "p2p", "seasonal", "unknown"];
const causeLabel = { water: "Water", food: "Food", p2p: "Person to person", seasonal: "Seasonal", unknown: "Unknown" };
const topCause = (p) => causeOrder.reduce((b, c) => (p[c] > p[b] ? c : b));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const alerts = [...D.alerts].sort((a, b) => b.date.localeCompare(a.date) || b.score - a.score);
const openWards = new Set(alerts.map((a) => a.wardId));
const risk = (id) => openWards.has(id) ? "alert" : (D.probability[id] ?? 0) >= LINE ? "line" : (D.probability[id] ?? 0) >= 0.1 ? "watch" : "quiet";
const fill = { quiet: "var(--risk-quiet)", watch: "var(--risk-watch)", line: "var(--risk-line)", alert: "var(--risk-alert)" };

function shell(cur) {
  return \`<header class="topbar">
    <div class="brand">\${D.icons.droplets}Outbreak Watch</div>
    <nav class="nav" aria-label="Main"><a class="\${cur === "overview" ? "cur" : ""}" href="#">Overview</a><a href="#">Proof</a><a href="#">Data and sources</a></nav>
    <div class="topright">
      <span>\${fmtDate(D.today, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
      <span class="live">\${D.icons["refresh-cw"]}Updated 6 s ago</span>
      <span class="who">\${D.icons.user}Duty officer</span>
      <button class="iconbtn" aria-label="Switch theme">\${document.documentElement.dataset.theme === "dark" ? D.icons.sun : D.icons.moon}</button>
    </div></header>
    <div class="banner" role="note">\${D.icons.info}<span>Prototype. Health signals are simulated; rain, ward and water-zone boundaries are real.</span><a href="#">Data and sources</a></div>\`;
}

function cityMap({ w, h, focusZone, showTip }) {
  const M = D.map;
  let vb = \`0 0 \${M.W} \${M.H}\`;
  const wards = M.wardPaths.map((p) => \`<path class="ward\${risk(p.id) === "alert" ? " alert" : ""}" d="\${p.d}" fill="\${fill[risk(p.id)]}"><title>\${ward(p.id).name}</title></path>\`).join("");
  const zones = M.zonePaths.map((z) => \`<path class="zone" d="\${z.d}"/>\`).join("");
  const sus = M.zonePaths.filter((z) => z.id === 14).map((z) => \`<path class="suspect" d="\${z.d}"/>\`).join("");
  return \`<svg class="citymap" viewBox="\${vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of 243 wards coloured by risk">\${wards}\${zones}\${sus}</svg>\`;
}

function overview() {
  const today = alerts.filter((a) => a.date === D.today);
  const rainToday = D.rain.at(-1);
  const p = D.proof;
  const ch = (m) => p.chance.find((r) => r.method === m);
  const methodName = { bayes: "Bayes (fused signals)", cusum: "CUSUM", threshold: "Threshold" };
  $("#overview").innerHTML = shell("overview") + \`<main>
    <section class="card map" aria-labelledby="maph">
      <div class="card-h"><h2 id="maph">Wards by risk</h2><span class="meta">243 wards, 43 BWSSB water zones, \${fmtDate(D.today)}</span></div>
      <div class="mapwrap">\${cityMap({})}
        <div class="zonelabel" style="left:16px;top:96px">Suspected zone NW3, zone 14</div>
        <div class="tip" style="left:360px;top:112px"><b>Kanneshwara Rama</b>Ward 39, water zone NW3 (zone 14)<br><span style="display:inline-flex;align-items:center;gap:6px;color:var(--ink)">\${D.icons.siren}Open alert, \${pct(alerts.find((a)=>a.wardId===39).score)} chance</span><br><span style="color:var(--muted)">Click to open the alert</span></div>
        <div class="attrib">Basemap not shown in mockup. OpenFreeMap © OpenMapTiles Data from OpenStreetMap</div>
      </div>
      <div class="legend" aria-label="Legend">
          <div class="row"><span class="sw" style="background:var(--risk-quiet)"></span>Quiet, under 10%</div>
          <div class="row"><span class="sw" style="background:var(--risk-watch)"></span>\${D.icons["circle-dot"]}Watch, 10% to alert line</div>
          <div class="row"><span class="sw" style="background:var(--risk-line)"></span>\${D.icons["triangle-alert"]}Above alert line</div>
          <div class="row"><span class="sw" style="background:var(--risk-alert);border-color:var(--ink)"></span>\${D.icons.siren}Open alert</div>
          <div class="row"><svg width="16" height="16" aria-hidden="true"><line x1="0" y1="8" x2="16" y2="8" stroke="var(--zone-line)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>BWSSB water zone</div>
          <div class="row"><svg width="16" height="16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="var(--accent)" stroke-width="3"/></svg>Suspected zone</div>
        </div>
    </section>
    <div class="kpis">
      <section class="card kpi"><span class="lab">Open alerts</span><span class="grp"><span class="fig">\${alerts.length}</span><span class="meta">\${today.length} raised today</span></span></section>
      <section class="card kpi"><span class="lab">Alerts today</span><span class="grp"><span class="fig">\${today.length}</span><span class="meta">Both in water zone NW3</span></span></section>
      <section class="card kpi"><span class="lab">Wards with no data</span><span class="grp"><span class="fig">0<small>of 243</small></span><span class="meta">No rows in 2 days. Hospital rows come 1 to 3 days late.</span></span></section>
      <section class="card kpi"><span class="lab" style="display:flex;justify-content:space-between;align-items:center">Rain today <span class="badge real">Real</span></span><span class="grp"><span class="fig">\${rainToday.mm}<small>mm</small></span><span class="meta">Open-Meteo. Moderate rain starts at 15.6 mm.</span></span></section>
    </div>
    <section class="card queue" aria-labelledby="qh">
      <div class="card-h"><h2 id="qh">Alerts</h2><span class="meta">Newest first</span></div>
      <div class="filters"><div class="seg" role="group" aria-label="Status"><button class="cur">Open \${alerts.length}</button><button>Acknowledged 0</button><button>Resolved 0</button></div>
        <span class="select">All causes \${D.icons["chevron-down"]}</span></div>
      <ul class="qlist">\${alerts.map((a, i) => { const w = ward(a.wardId); const c = topCause(a.causeProbs); return \`<li class="qitem\${i === 0 ? " sel" : ""}"><span class="bar"></span>
        <div><div class="name">\${w.name}</div><div class="meta">Ward \${w.id}\${w.zoneId ? ", zone " + zoneName(w.zoneId) : ", no water zone"}, \${fmtDate(a.date)}</div>
        <div class="cause"><span class="dot" style="background:var(--c-\${c})"></span>Triage hint: \${causeLabel[c]} \${pct(a.causeProbs[c])}</div></div>
        <div class="qscore"><div class="pct">\${pct(a.score)}</div><div class="meta">chance</div></div></li>\`; }).join("")}</ul>
    </section>
    <section class="card proof" aria-labelledby="ph">
      <div class="intro"><div><h2 id="ph">How well it works</h2><p class="meta">Results on simulated outbreaks. Realistic setting, 0.25 false alarms per ward per year, \${p.chanceSeeds} seeds. Bayes is not the best method everywhere.</p></div><a href="#">See the full results</a></div>
      \${["bayes", "cusum", "threshold"].map((m) => { const r = ch(m); return \`<div class="pm"><div><div class="lab" style="font-weight:500">\${methodName[m]}</div><div class="meta">Local outbreaks found</div></div>
        <div class="vs"><div class="vrow"><span>Found</span><div class="track"><i style="width:\${r.realDetected * 100}%;background:var(--accent)"></i></div><span>\${pct(r.realDetected)}</span></div><div class="vrow"><span>By chance</span><div class="track"><i style="width:\${r.phantomDetected * 100}%;background:var(--c-unknown)"></i></div><span>\${pct(r.phantomDetected)}</span></div>
        </div></div>\`; }).join("")}
    </section>
  </main>\`;
}

function chartSvg(series, opts) {
  const W = 1181, H = 140, padL = 40, padB = 28, padT = 10;
  const vals = series.flatMap((d) => [d.count ?? 0, d.normal ?? 0]);
  const max = Math.max(...vals) * 1.15 || 1;
  const n = series.length, bw = (W - padL) / n;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const bars = series.map((d, i) => d.count === null
    ? \`<rect x="\${padL + i * bw + 1}" y="\${y(d.normal ?? 0)}" width="\${bw - 2}" height="\${H - padB - y(d.normal ?? 0)}" fill="none" stroke="var(--muted)" stroke-dasharray="2 2"/>\`
    : \`<rect x="\${padL + i * bw + 1}" y="\${y(d.count)}" width="\${bw - 2}" height="\${H - padB - y(d.count)}" fill="\${d.date >= "2026-07-06" ? "var(--risk-alert)" : "var(--muted)"}" opacity="\${d.date >= "2026-07-06" ? 1 : .45}"/>\`).join("");
  const line = series.map((d, i) => d.normal === null ? "" : \`\${i === 0 || series[i - 1].normal === null ? "M" : "L"}\${padL + i * bw},\${y(d.normal)}H\${padL + (i + 1) * bw}\`).join("");
  const ticks = [Math.round(max / 2), Math.round(max * 0.9)].map((t) => \`<text x="\${padL - 6}" y="\${y(t) + 5}" text-anchor="end" font-size="15" fill="var(--muted)">\${t}</text><line x1="\${padL}" x2="\${W}" y1="\${y(t)}" y2="\${y(t)}" stroke="var(--hairline)"/>\`).join("");
  const xl = series.map((d, i) => (i % 14 === 0 || i === n - 1) ? \`<text x="\${padL + i * bw + bw / 2}" y="\${H - 4}" text-anchor="\${i === n - 1 ? "end" : "middle"}" font-size="15" fill="var(--muted)">\${fmtDate(d.date)}</text>\` : "").join("");
  const ai = n - 1, ax = padL + ai * bw + bw / 2;
  return \`<svg viewBox="0 0 \${W} \${H}" preserveAspectRatio="none" role="img" aria-label="\${opts.label}">\${ticks}\${bars}<path d="\${line}" fill="none" stroke="var(--ink)" stroke-width="1.6"/>
    <line x1="\${ax}" x2="\${ax}" y1="\${padT}" y2="\${H - padB}" stroke="var(--accent)" stroke-width="2"/>\${xl}</svg>\`;
}

function detail() {
  const a = alerts.find((x) => x.wardId === 39);
  const w = ward(39);
  const split = a.evidence.findIndex((e) => e.startsWith("chance of an outbreak")) + 1;
  const det = a.evidence.slice(0, split - 1), why = a.evidence.slice(split, -1);
  const S = D.series39;
  const label = { complaint: "Complaints", pharmacy: "Pharmacy sales", hospital: "Hospital visits" };
  const lastSeen = (sig) => [...S[sig]].reverse().find((d) => d.count !== null);
  const late = (sig) => S[sig].filter((d) => d.count === null).map((d) => fmtDate(d.date));
  const arrivedLate = (sig) => S[sig].filter((d) => d.count !== null && d.reportedOn > d.date).slice(-1)[0];
  const zoneWards = D.city.filter((x) => x.zoneId === 14).map((x) => x.id);
  const zp = D.map.wardPaths.filter((p) => zoneWards.includes(p.id) || zoneWards.some((z) => ward(z).neighbours.includes(p.id)));
  const nums = zp.flatMap((p) => p.d.match(/-?[\\d.]+,-?[\\d.]+/g).map((s) => s.split(",").map(Number)));
  const xs = nums.map((q) => q[0]), ys = nums.map((q) => q[1]);
  const vb = [Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) - Math.min(...xs) + 12, Math.max(...ys) - Math.min(...ys) + 12].join(" ");
  const rmax = Math.max(...D.rain.map((r) => r.mm));
  $("#detail").innerHTML = shell("") + \`<main>
    <section class="card dhead">
      <div><div class="crumb"><a href="#">Overview</a> / Alert</div><h1>\${w.name}</h1>
        <div class="meta" style="margin-top:4px">Ward \${w.id}, water zone NW3 (zone 14), suspected. Raised \${fmtDate(a.date, { day: "numeric", month: "long", year: "numeric" })} by the Bayes detector, daily run.</div></div>
      <div class="score"><div class="fig">\${pct(a.score)}</div><div class="meta">chance of an outbreak</div></div>
      <div style="display:grid;gap:var(--s3);justify-items:end"><span class="status">\${D.icons.siren}Open</span>
        <div class="actions"><button class="btn primary">\${D.icons.check}Acknowledge</button><button class="btn">\${D.icons["circle-check"]}Resolve</button><button class="btn">\${D.icons["message-square-plus"]}Add note</button></div></div>
    </section>
    <div class="left">
      <section class="card"><div class="card-h"><h2>Signals, last 8 weeks</h2><span class="meta">Bars: daily count. Line: normal for that weekday (median of the 8 weeks before). Blue line: alert day.</span></div>
        \${["complaint", "pharmacy", "hospital"].map((sig) => { const ls = lastSeen(sig); const al = arrivedLate(sig); const lt = late(sig); return \`<div class="chart">
          <div class="chart-h"><b>\${label[sig]}</b><span class="badge sim">Simulated</span><span class="meta">Latest: \${ls.count} on \${fmtDate(ls.date)}, normal \${ls.normal}</span></div>
          \${chartSvg(S[sig], { label: label[sig] + ", last 8 weeks" })}
          \${lt.length || (al && al.reportedOn > al.date) ? \`<div class="late">\${D.icons.clock}\${lt.length ? "Not reported yet: " + lt.join(", ") + ". " : ""}\${al && al.reportedOn > al.date ? "The " + fmtDate(al.date) + " count arrived " + fmtDate(al.reportedOn) + "." : ""}</div>\` : ""}
        </div>\`; }).join("")}
      </section>
      <section class="card"><div class="card-h"><h2>Why the detector alerted</h2><span class="meta">From the Bayes detector</span></div>
        <ul class="ev">\${det.map((e) => \`<li>\${cap(e)}</li>\`).join("")}</ul></section>
    </div>
    <div class="right">
      <section class="card"><div class="card-h"><h3>Likely cause</h3><span class="badge hint">Triage hint, not a diagnosis</span></div>
        <div class="causebars">\${causeOrder.slice().sort((x, y) => a.causeProbs[y] - a.causeProbs[x]).map((c) => \`<div class="cb"><span style="display:flex;gap:8px;align-items:center"><span class="dot" style="background:var(--c-\${c})"></span>\${causeLabel[c]}</span>
          <div class="track"><i style="width:\${a.causeProbs[c] * 100}%;background:var(--c-\${c})"></i></div><span class="v">\${pct(a.causeProbs[c])}</span></div>\`).join("")}</div>
        <ul class="why">\${why.map((e) => \`<li>\${cap(e)}</li>\`).join("")}</ul>
        <p class="meta" style="padding:0 var(--s5) var(--s4)">An officer must confirm the cause.</p></section>
      <section class="card"><div class="card-h"><h3>Suspected zone NW3, zone 14</h3><span class="meta">6 wards, 2 alerting</span></div>
        <div class="mini"><svg viewBox="\${vb}" role="img" aria-label="Map of water zone NW3">\${zp.map((p) => \`<path d="\${p.d}" class="ward\${openWards.has(p.id) ? " alert" : ""}" fill="\${zoneWards.includes(p.id) ? fill[risk(p.id)] : "var(--sunken)"}" opacity="\${zoneWards.includes(p.id) ? 1 : .7}"/>\`).join("")}\${D.map.zonePaths.filter((z) => z.id === 14).map((z) => \`<path class="suspect" d="\${z.d}"/>\`).join("")}</svg></div></section>
      <section class="card"><div class="card-h"><h3>Rain, last 14 days</h3><span class="badge real">Real</span></div>
        <div class="rain"><svg viewBox="0 0 420 96" role="img" aria-label="Daily rain">\${D.rain.map((r, i) => \`<rect x="\${i * 30 + 2}" y="\${72 - (r.mm / rmax) * 60}" width="24" height="\${(r.mm / rmax) * 60}" fill="var(--c-water)"/>\${i % 4 === 1 || i === 13 ? \`<text x="\${i * 30 + 14}" y="92" text-anchor="middle" font-size="15" fill="var(--muted)">\${fmtDate(r.date)}</text>\` : ""}\`).join("")}</svg>
        <p class="meta">Highest \${rmax} mm on \${fmtDate(D.rain.find((r) => r.mm === rmax).date)}. No day reached moderate rain (15.6 mm). Open-Meteo, one value for the whole city.</p></div></section>
      <section class="card"><div class="card-h"><h3>Activity</h3></div>
        <ol class="tl"><li>\${D.icons.siren}<div>Raised by the daily detector run<div class="meta">\${fmtDate(a.date, { day: "numeric", month: "long", year: "numeric" })}</div></div></li>
          <li>\${D.icons["message-square-plus"]}<div class="meta">No notes yet. Use Add note to record what you checked.</div></li></ol></section>
    </div>
  </main>\`;
}

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
overview(); detail();
document.getElementById(params.get("screen") ?? "overview").classList.add("on");
</script>
</body></html>`;
writeFileSync(new URL("./mockups.html", import.meta.url), html);
console.log("wrote mockups.html", (html.length / 1024).toFixed(0), "KB");
