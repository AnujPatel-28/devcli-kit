/**
 * The inbox: one self-contained page served by the hub. No build step, no
 * external requests. Every agent-supplied string is inserted with textContent.
 */
export function renderInboxPage(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>clidev inbox</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23080d1a'/%3E%3Cpath d='M9 11l5 5-5 5' stroke='%23709de9' stroke-width='2.4' fill='none' stroke-linecap='round'/%3E%3Cpath d='M17 21h7' stroke='%23ffffff' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E">
<style>
:root{
  --bg:#f6f7fb; --surface:#ffffff; --line:#e1e5ee; --ink:#111827; --body:#374151; --muted:#6b7280;
  --accent:#2f5fd0; --accent-ink:#ffffff; --ok:#16794c; --warn:#a15c00; --err:#b42318; --focus:#2f5fd0;
  --chip:#eef2fb;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0b1020; --surface:#121a2e; --line:#24304a; --ink:#f3f6fc; --body:#c4cde0; --muted:#8a97b2;
    --accent:#709de9; --accent-ink:#06122b; --ok:#5ad1a0; --warn:#e6b566; --err:#f2777a; --focus:#8fb3f0;
    --chip:#1a2540;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--body);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
main{max-width:880px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 16px;margin-bottom:20px}
h1{margin:0;color:var(--ink);font-size:22px;letter-spacing:-.01em}
h2{margin:32px 0 12px;color:var(--ink);font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.status{font-size:13px;color:var(--muted)}
.status b{color:var(--ok);font-weight:600}
.status.offline b{color:var(--err)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat .v{display:block;color:var(--ink);font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}
.stat .k{font-size:12px;color:var(--muted)}
@media (max-width:560px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.empty{border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.card.permission{border-left-color:var(--warn)}
.card.question{border-left-color:var(--ok)}
.meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12.5px;color:var(--muted);margin-bottom:8px}
.agent{background:var(--chip);color:var(--ink);border-radius:999px;padding:2px 9px;font-weight:600}
.what{color:var(--ink);font-weight:600;font-size:16px;margin:0 0 6px}
.summary{margin:0 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}
pre{margin:0 0 12px;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:8px;font:13px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink)}
textarea{width:100%;min-height:76px;resize:vertical;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans)}
textarea:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
button{font:inherit;font-size:14px;font-weight:600;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button.danger{color:var(--err)}
button:disabled{opacity:.55;cursor:default}
.tip{font-size:12.5px;color:var(--muted);margin-left:auto}
kbd{font:12px var(--mono);border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 4px}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:14px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}
tr:last-child td{border-bottom:0}
td.s{white-space:nowrap}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--muted)}
.dot.working{background:var(--accent)} .dot.waiting{background:var(--warn)} .dot.done{background:var(--ok)}
.clip{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.table-wrap{overflow-x:auto}
</style>
</head>
<body>
<main>
  <header>
    <h1>clidev inbox</h1>
    <span id="status" class="status"><b>●</b> connecting…</span>
  </header>

  <section class="stats" aria-label="Reply statistics">
    <div class="stat"><span class="v" id="st-answered">0</span><span class="k">asks answered</span></div>
    <div class="stat"><span class="v" id="st-median">–</span><span class="k">median reply time</span></div>
    <div class="stat"><span class="v" id="st-words">0</span><span class="k">words replied</span></div>
    <div class="stat"><span class="v" id="st-agents">0</span><span class="k">agents connected</span></div>
  </section>

  <h2>Waiting for you</h2>
  <div id="asks" aria-live="polite"></div>

  <h2>Sessions</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Agent</th><th>Project</th><th>State</th><th>Latest</th></tr></thead>
    <tbody id="sessions"></tbody>
  </table></div>
</main>
<script>
const TOKEN = ${JSON.stringify(token)};
const LABELS = {claude:"Claude Code",opencode:"OpenCode",antigravity:"Antigravity",codex:"Codex CLI",gemini:"Gemini CLI",watch:"clidev watch"};
const label = (a) => LABELS[a] || a;
const $ = (id) => document.getElementById(id);
const cards = new Map();

function el(tag, attrs, ...children){
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v; else if (k.startsWith("on")) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function ago(ms){
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + "s ago";
  const m = Math.round(s / 60);
  return m < 60 ? m + "m ago" : Math.round(m / 60) + "h ago";
}

function duration(ms){
  if (ms == null) return "–";
  const s = Math.round(ms / 1000);
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

async function api(path, body){
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {"x-clidev-token": TOKEN, "content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

function buildCard(ask){
  const what = ask.kind === "permission" ? "Wants to run " + (ask.tool || "a tool")
    : ask.kind === "question" ? "Has a question" : "Finished — what next?";
  const box = el("textarea", {
    "aria-label": "Your reply to " + label(ask.agent),
    placeholder: ask.kind === "permission"
      ? "Optional: say what to do instead, e.g. \\"no, run npm run clean\\""
      : "Hold your Wispr key and say what to do next…",
  });
  const buttons = [];
  const submit = async (payload) => {
    for (const b of buttons) b.disabled = true;
    try { await api("/api/asks/" + ask.id + "/reply", payload); } finally { refresh(); }
  };
  const text = () => box.value.trim();
  const add = (labelText, cls, handler) => {
    const b = el("button", {class: cls, type: "button", onclick: handler}, labelText);
    buttons.push(b); return b;
  };

  let primary;
  const actions = el("div", {class: "actions"});
  if (!ask.canReply) {
    actions.append(el("span", {class: "tip"}, "This agent can't take replies from here — switch to its terminal."));
  } else if (ask.kind === "permission") {
    primary = () => text() ? submit({decision: "deny", text: text()}) : submit({decision: "allow"});
    actions.append(
      add("Allow", "primary", () => submit({decision: "allow"})),
      add("Deny", "danger", () => submit(text() ? {decision: "deny", text: text()} : {decision: "deny"})),
      add("Answer in terminal", "", () => submit({decision: "terminal"})),
    );
  } else {
    primary = () => text() && submit({text: text()});
    actions.append(
      add(ask.kind === "done" ? "Send & continue" : "Send answer", "primary", primary),
      add(ask.kind === "done" ? "Leave it stopped" : "Answer in terminal", "", () => submit({decision: "terminal"})),
    );
  }
  if (primary) {
    actions.append(el("span", {class: "tip"}, el("kbd", {}, "Ctrl"), " + ", el("kbd", {}, "Enter"), " to send"));
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); primary(); }
    });
  }

  const card = el("article", {class: "card " + ask.kind},
    el("div", {class: "meta"}, el("span", {class: "agent"}, label(ask.agent)), el("span", {}, ask.project), el("span", {"data-ago": ask.createdAt}, ago(ask.createdAt))),
    el("p", {class: "what"}, what),
    ask.summary && ask.kind === "done" ? el("p", {class: "summary"}, ask.summary) : null,
    ask.detail ? el("pre", {}, ask.detail) : null,
    ask.canReply ? box : null,
    actions,
  );
  card._box = box;
  return card;
}

function renderAsks(asks){
  const root = $("asks");
  const open = new Set(asks.map((a) => a.id));
  for (const [id, card] of cards) if (!open.has(id)) { card.remove(); cards.delete(id); }
  for (const ask of asks) {
    if (!cards.has(ask.id)) {
      const card = buildCard(ask);
      cards.set(ask.id, card);
      root.append(card);
      const active = document.activeElement;
      if (!active || active === document.body) card._box.focus();
    }
  }
  for (const node of root.querySelectorAll("[data-ago]")) node.textContent = ago(Number(node.dataset.ago));
  const empty = root.querySelector(".empty");
  if (asks.length === 0 && !empty) root.append(el("div", {class: "empty"}, "Nothing is waiting on you. Go do something else — you'll get a notification."));
  if (asks.length > 0 && empty) empty.remove();
  document.title = asks.length > 0 ? "(" + asks.length + ") clidev inbox" : "clidev inbox";
}

function renderSessions(sessions){
  const body = $("sessions");
  body.replaceChildren(...(sessions.length === 0
    ? [el("tr", {}, el("td", {colspan: "4"}, "No agent has reported yet. Run clidev hooks --claude, then start a session."))]
    : sessions.map((s) => el("tr", {},
        el("td", {class: "s"}, label(s.agent)),
        el("td", {class: "s"}, s.project),
        el("td", {class: "s"}, el("span", {class: "dot " + s.state}), s.state, " · " + ago(s.updatedAt)),
        el("td", {}, el("span", {class: "clip"}, s.summary || "")),
      ))));
}

let failures = 0;
async function refresh(){
  try {
    const state = await api("/api/state");
    failures = 0;
    $("status").className = "status";
    $("status").replaceChildren(el("b", {}, "●"), " hub running");
    renderAsks(state.asks);
    renderSessions(state.sessions);
    $("st-answered").textContent = state.stats.answered;
    $("st-median").textContent = duration(state.stats.medianReplyMs);
    $("st-words").textContent = state.stats.wordsReplied.toLocaleString();
    $("st-agents").textContent = new Set([...state.stats.agents, ...state.sessions.map((s) => s.agent)]).size;
  } catch {
    failures += 1;
    if (failures > 1) {
      $("status").className = "status offline";
      $("status").replaceChildren(el("b", {}, "●"), " hub offline — run clidev inbox");
    }
  }
}
refresh();
setInterval(refresh, 1500);
</script>
</body>
</html>`;
}
