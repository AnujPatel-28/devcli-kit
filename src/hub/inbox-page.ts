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
  --bg:#f6f7fb; --surface:#ffffff; --line:#e1e5ee; --ink:#111827; --body:#374151; --muted:#5f6675;
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
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{margin:0;background:var(--bg);color:var(--body);font:400 0.9375rem/1.55 var(--sans)}
main{max-width:55rem;margin:0 auto;padding:1.75rem 1rem 4rem}
header{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:0.5rem 1rem;margin-bottom:1.25rem}
h1{margin:0;color:var(--ink);font-size:1.375rem;line-height:1.2;letter-spacing:-0.01em}
h2{margin:2rem 0 0.75rem;color:var(--ink);font-size:0.8125rem;line-height:1.3;letter-spacing:0.08em;text-transform:uppercase}
h3{margin:0 0 0.375rem;color:var(--ink);font-size:1rem;line-height:1.3;font-weight:600}
.status{font-size:0.8125rem;color:var(--muted)}
.status .dot{background:var(--ok)}
.status.offline{color:var(--err)}
.status.offline .dot{background:var(--err)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0.5rem}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:0.75rem 0.875rem}
.stat .v{display:block;color:var(--ink);font-size:1.25rem;line-height:1.3;font-weight:650;font-variant-numeric:tabular-nums}
.stat .k{font-size:0.75rem;color:var(--muted)}
@media (max-width:35rem){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
.empty{border:1px dashed var(--line);border-radius:12px;padding:1.375rem;text-align:center;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-inline-start:4px solid var(--accent);border-radius:12px;padding:1rem 1.125rem;margin-bottom:0.75rem}
.card.permission{border-inline-start-color:var(--warn)}
.card.question{border-inline-start-color:var(--ok)}
.meta{display:flex;flex-wrap:wrap;gap:0.375rem 0.625rem;align-items:center;font-size:0.8125rem;color:var(--muted);margin-bottom:0.5rem}
.agent{background:var(--chip);color:var(--ink);border-radius:999px;padding:0.125rem 0.5625rem;font-weight:600;white-space:nowrap}
time,.when{font-variant-numeric:tabular-nums}
.message{margin:0 0 0.75rem;white-space:pre-wrap;overflow-wrap:anywhere;max-width:72ch}
details{margin:-0.25rem 0 0.75rem}
summary{cursor:pointer;color:var(--accent);font-weight:600;font-size:0.875rem}
details .message{margin-top:0.5rem}
pre{margin:0 0 0.75rem;padding:0.625rem 0.75rem;background:var(--bg);border:1px solid var(--line);border-radius:8px;font:0.8125rem/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink)}
label{display:block;color:var(--ink);font-weight:600;font-size:0.875rem}
.help{margin:0.125rem 0 0.5rem;font-size:0.8125rem;color:var(--muted)}
textarea{width:100%;min-height:4.75rem;resize:vertical;padding:0.625rem 0.75rem;border:1px solid var(--muted);border-radius:8px;background:var(--bg);color:var(--ink);font:0.9375rem/1.5 var(--sans)}
textarea::placeholder{color:var(--muted);opacity:1}
textarea:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.actions{display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.625rem;align-items:center}
button{font:inherit;font-size:0.875rem;font-weight:600;border-radius:8px;padding:0.5rem 0.875rem;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
button:disabled{opacity:.55;cursor:default}
@media (prefers-reduced-motion: no-preference){
  button{transition:scale 150ms ease-out}
  button:not(:disabled):active{scale:0.96}
}
.tip{font-size:0.8125rem;color:var(--muted);margin-inline-start:auto}
kbd{font:0.75rem var(--mono);border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;padding:0 0.25rem}
.error{margin:0.5rem 0 0;color:var(--err);font-size:0.875rem;font-weight:600}
.error:empty{display:none}
.sessions{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:12px}
.sessions li{padding:0.625rem 0.875rem;border-bottom:1px solid var(--line)}
.sessions li:last-child{border-bottom:0}
.row{display:flex;flex-wrap:wrap;gap:0.25rem 0.75rem;align-items:baseline}
.row .who{color:var(--ink);font-weight:600}
.row .state{color:var(--muted);font-size:0.8125rem}
.latest{margin:0.125rem 0 0;overflow-wrap:anywhere;font-size:0.875rem}
.dot{display:inline-block;width:0.5rem;height:0.5rem;border-radius:50%;margin-inline-end:0.375rem;background:var(--muted)}
.dot.working{background:var(--accent)} .dot.waiting{background:var(--warn)} .dot.done{background:var(--ok)}
.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
</style>
</head>
<body>
<main>
  <header>
    <h1>clidev inbox</h1>
    <span id="status" class="status"><span class="dot" aria-hidden="true"></span>Connecting…</span>
  </header>
  <p id="announce" class="visually-hidden" role="status"></p>

  <section class="stats" aria-label="Reply statistics">
    <div class="stat"><span class="v" id="st-answered">0</span><span class="k">asks answered</span></div>
    <div class="stat"><span class="v" id="st-median">–</span><span class="k">median reply time</span></div>
    <div class="stat"><span class="v" id="st-words">0</span><span class="k">words replied</span></div>
    <div class="stat"><span class="v" id="st-agents">0</span><span class="k">agents connected</span></div>
  </section>

  <h2>Waiting for you</h2>
  <div id="asks"></div>

  <h2>Sessions</h2>
  <ul id="sessions" class="sessions"></ul>
</main>
<script>
const TOKEN = ${JSON.stringify(token)};
const LABELS = {claude:"Claude Code",opencode:"OpenCode",antigravity:"Antigravity",codex:"Codex CLI",gemini:"Gemini CLI",watch:"clidev watch"};
const PREVIEW_CHARS = 600;
const label = (a) => LABELS[a] || a;
const $ = (id) => document.getElementById(id);
const cards = new Map();
let firstLoad = true;
let seq = 0;

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
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  return m < 60 ? m + " min ago" : Math.floor(m / 60) + " h ago";
}

function stamp(ms){
  return el("time", {datetime: new Date(ms).toISOString(), "data-ago": String(ms)}, ago(ms));
}

function duration(ms){
  if (ms == null) return "–";
  const s = Math.round(ms / 1000);
  return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
}

async function api(path, body){
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {"x-clidev-token": TOKEN, "content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {ok: res.ok, status: res.status, body: await res.json()};
}

function messageBlock(text){
  if (!text) return null;
  if (text.length <= PREVIEW_CHARS) return el("p", {class: "message"}, text);
  const block = document.createDocumentFragment();
  block.append(
    el("p", {class: "message"}, text.slice(0, PREVIEW_CHARS).trimEnd() + "…"),
    el("details", {}, el("summary", {}, "Show the full message"), el("p", {class: "message"}, text)),
  );
  return block;
}

const COPY = {
  done: {title: "Finished. What next?", label: "What should it do next?", example: "Add a test for page size zero, then commit", send: "Send and continue", back: "Leave it stopped", tip: "sends your reply"},
  question: {title: "Has a question", label: "Your answer", example: "", send: "Send answer", back: "Answer in terminal", tip: "sends your answer"},
  permission: {label: "Instructions instead (optional)", example: "Run npm run clean instead", tip: "refuses and sends your instructions"},
};

function buildCard(ask){
  const copy = COPY[ask.kind] || COPY.done;
  const id = "reply-" + (++seq);
  const helpId = id + "-help";
  const box = el("textarea", {id, "aria-describedby": helpId, placeholder: copy.example});
  const error = el("p", {class: "error", role: "status"});
  const buttons = [];
  const text = () => box.value.trim();

  const submit = async (payload) => {
    for (const b of buttons) b.disabled = true;
    error.textContent = "";
    try {
      const res = await api("/api/asks/" + ask.id + "/reply", payload);
      if (res.status === 409) error.textContent = "This request already closed, so your reply was not sent. Check the agent's terminal.";
      else if (!res.ok) throw new Error(res.body && res.body.error);
    } catch {
      error.textContent = "Unable to send your reply. Check that the hub is running with clidev inbox, then try again.";
      for (const b of buttons) b.disabled = false;
      return;
    }
    refresh();
  };
  const add = (text, cls, handler) => {
    const b = el("button", {class: cls, type: "button", onclick: handler}, text);
    buttons.push(b);
    return b;
  };

  let shortcut = null;
  const actions = el("div", {class: "actions"});
  if (ask.kind === "permission") {
    // Approval is always a deliberate click: the shortcut only ever refuses.
    shortcut = () => { if (text()) submit({decision: "deny", text: text()}); };
    actions.append(
      add("Allow", "primary", () => submit({decision: "allow"})),
      add("Deny", "", () => submit(text() ? {decision: "deny", text: text()} : {decision: "deny"})),
      add("Answer in terminal", "", () => submit({decision: "terminal"})),
    );
  } else {
    const send = () => {
      if (!text()) { error.textContent = "Say or type a reply first, or choose \u201c" + copy.back + "\u201d."; box.focus(); return; }
      submit({text: text()});
    };
    shortcut = send;
    actions.append(
      add(copy.send, "primary", send),
      add(copy.back, "", () => submit({decision: "terminal"})),
    );
  }
  actions.append(el("span", {class: "tip"}, el("kbd", {}, "Ctrl"), " + ", el("kbd", {}, "Enter"), " " + copy.tip));
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); shortcut(); }
  });

  const title = ask.kind === "permission" ? "Wants to run " + (ask.tool || "a tool") : ask.canReply ? copy.title : "Finished";
  const reply = ask.canReply
    ? [el("label", {for: id}, copy.label), el("p", {class: "help", id: helpId}, "Hold your Wispr key and speak, or type."), box, actions, error]
    : [el("p", {class: "help"}, "This agent can't take replies from the inbox. Switch to its terminal to continue.")];

  const card = el("article", {class: "card " + ask.kind},
    el("div", {class: "meta"}, el("span", {class: "agent"}, label(ask.agent)), el("span", {}, ask.project), stamp(ask.createdAt)),
    el("h3", {}, title),
    ask.kind === "done" ? messageBlock(ask.summary) : null,
    ask.detail ? el("pre", {}, ask.detail) : null,
    ...reply,
  );
  card._box = ask.canReply ? box : null;
  return card;
}

function announce(ask){
  const what = ask.kind === "permission" ? "needs permission" : ask.kind === "question" ? "has a question" : "finished";
  $("announce").textContent = label(ask.agent) + " in " + ask.project + " " + what + ".";
}

function renderAsks(asks){
  const root = $("asks");
  const open = new Set(asks.map((a) => a.id));
  for (const [id, card] of cards) if (!open.has(id)) { card.remove(); cards.delete(id); }
  for (const ask of asks) {
    if (cards.has(ask.id)) continue;
    const card = buildCard(ask);
    cards.set(ask.id, card);
    root.append(card);
    if (!firstLoad) announce(ask);
    const active = document.activeElement;
    if (card._box && (!active || active === document.body)) card._box.focus();
  }
  for (const node of root.querySelectorAll("[data-ago]")) {
    const next = ago(Number(node.dataset.ago));
    if (node.textContent !== next) node.textContent = next;
  }
  const empty = root.querySelector(".empty");
  if (asks.length === 0 && !empty) root.append(el("p", {class: "empty"}, "Nothing is waiting on you. Go do something else; you'll get a notification when an agent needs you."));
  if (asks.length > 0 && empty) empty.remove();
  document.title = asks.length > 0 ? "(" + asks.length + ") clidev inbox" : "clidev inbox";
  firstLoad = false;
}

function renderSessions(sessions){
  const list = $("sessions");
  list.replaceChildren(...(sessions.length === 0
    ? [el("li", {}, "No agent has reported yet. Run clidev hooks --claude, then start a session.")]
    : sessions.map((s) => el("li", {},
        el("div", {class: "row"},
          el("span", {class: "who"}, label(s.agent)),
          el("span", {}, s.project),
          el("span", {class: "state"}, el("span", {class: "dot " + s.state, "aria-hidden": "true"}), s.state, " · ", stamp(s.updatedAt)),
        ),
        s.summary ? el("p", {class: "latest"}, s.summary) : null,
      ))));
}

function setStatus(online){
  const status = $("status");
  status.className = online ? "status" : "status offline";
  status.replaceChildren(el("span", {class: "dot", "aria-hidden": "true"}), online ? "Hub running" : "Hub offline. Run clidev inbox to restart it.");
}

let failures = 0;
async function refresh(){
  try {
    const {body: state} = await api("/api/state");
    failures = 0;
    setStatus(true);
    renderAsks(state.asks);
    renderSessions(state.sessions);
    $("st-answered").textContent = state.stats.answered.toLocaleString();
    $("st-median").textContent = duration(state.stats.medianReplyMs);
    $("st-words").textContent = state.stats.wordsReplied.toLocaleString();
    $("st-agents").textContent = new Set([...state.stats.agents, ...state.sessions.map((s) => s.agent)]).size;
  } catch {
    failures += 1;
    if (failures > 1) setStatus(false);
  }
}
refresh();
setInterval(refresh, 1500);
</script>
</body>
</html>`;
}
