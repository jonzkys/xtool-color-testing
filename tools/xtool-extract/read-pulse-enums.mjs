// Read the open pulse-width <select> options from the Studio editor renderer.
// Prereq: Studio launched with --remote-debugging-port=9222, editor open, and
// the Pulse width dropdown for the target machine/mode visible.
// Usage: node read-pulse-enums.mjs   (auto-finds the editor page target)
const BASE = "http://127.0.0.1:9222";

const targets = await (await fetch(BASE + "/json")).json();
const editor = targets.find((t) => t.type === "page" && /renderer\/editor/.test(t.url || ""));
if (!editor) { console.error("no editor page target — open a project in Studio"); process.exit(1); }

const ws = new WebSocket(editor.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
});
ws.addEventListener("open", async () => {
  await send("Runtime.enable");
  const expr = `[...document.querySelectorAll('[role="option"]')].map(e=>e.textContent.trim()).filter(t=>/^\\d+$/.test(t)).map(Number)`;
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  process.stdout.write(JSON.stringify(r.result.value) + "\n");
  ws.close();
  process.exit(0);
});
