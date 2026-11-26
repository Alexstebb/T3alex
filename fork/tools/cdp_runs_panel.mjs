// Opens a pinned scheduled task's chat in a running smoke instance and measures the runs panel
// against the chat's title-bar controls; saves screenshots when the window can paint.
// usage: node cdp_runs_panel.mjs <port> <task title fragment> <output dir>
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const [port, titleFragment, outDir] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
NodeFS.mkdirSync(outDir, { recursive: true });

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res) => {
            const msgId = ++id;
            pending.set(msgId, res);
            ws.send(JSON.stringify({ id: msgId, method, params }));
          }),
        close: () => ws.close(),
      });
  });
}

const targets = await (await fetch(`${base}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith("t3code://app"));
if (!page) {
  console.log(JSON.stringify({ error: "no t3code://app page target" }));
  process.exit(1);
}
const client = await connect(page.webSocketDebuggerUrl);
const evaluate = async (expression) => {
  const r = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null;
};
const shot = async (name) => {
  const result = await Promise.race([
    client.send("Page.captureScreenshot", { format: "png" }),
    sleep(8000).then(() => null),
  ]);
  const data = result?.result?.data;
  if (!data) return false;
  NodeFS.writeFileSync(NodePath.join(outDir, name), Buffer.from(data, "base64"));
  return true;
};
const measure = () =>
  evaluate(`(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    const hit = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const resolve = (value) => {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;visibility:hidden;height:0;width:' + value;
      document.body.appendChild(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return Math.round(width);
    };
    const visible = (el) => !!el && el.getBoundingClientRect().width > 0;
    const controls = [...document.querySelectorAll('[data-workspace-titlebar-controls]')].filter(visible);
    const aside = [...document.querySelectorAll('aside')].find((el) => visible(el) && /Runs|Kj/.test(el.getAttribute('aria-label') || ''));
    const rail = [...document.querySelectorAll('[data-scheduled-runs-rail]')].find(visible);
    const label = aside ? [...aside.querySelectorAll('span')].find((el) => el.textContent.trim() === 'Scheduled' && el.children.length === 0) : null;
    const card = [...document.querySelectorAll('[data-slot="popover-popup"], [role="dialog"]')].find(visible);
    const toggle = [...document.querySelectorAll('[data-thread-panel-toggle]')].find(visible);
    const header = document.querySelector('[data-chat-header]');
    const nativeInset = resolve('calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px))');
    const native = nativeInset > 0 ? { left: innerWidth - nativeInset, top: 0, right: innerWidth, bottom: resolve('env(titlebar-area-height, 0px)') } : null;
    const controlRects = controls.map(rect);
    return {
      innerWidth, innerHeight, href: location.href,
      wco: !!document.querySelector('.wco'),
      nativeControls: native,
      titlebarControls: controlRects,
      runsAside: rect(aside), runsRail: rect(rail), scheduledLabel: rect(label),
      labelClipped: label ? label.scrollWidth > label.clientWidth : null,
      chatHeader: rect(header), detailsToggle: rect(toggle), detailsCard: rect(card),
      controlsOverAside: controlRects.some((r) => hit(r, rect(aside))),
      controlsOverRail: controlRects.some((r) => hit(r, rect(rail))),
      controlsUnderNative: controlRects.some((r) => hit(r, native)),
      controlsOverLabel: controlRects.some((r) => hit(r, rect(label))),
    };
  })()`);

const report = { titleFragment };
report.clicked = await evaluate(`(() => {
  const fragment = ${JSON.stringify(titleFragment)};
  const candidates = [...document.querySelectorAll('a, button, [role="button"]')]
    .filter((el) => el.textContent.includes(fragment) && el.getBoundingClientRect().width > 0)
    .sort((a, b) => a.textContent.length - b.textContent.length);
  if (!candidates[0]) return null;
  candidates[0].click();
  return candidates[0].textContent.trim().slice(0, 80);
})()`);
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const found = await evaluate(
    `!!document.querySelector('[data-scheduled-runs-rail]') || [...document.querySelectorAll('aside')].some((el) => /Runs/.test(el.getAttribute('aria-label') || ''))`,
  );
  if (found === true) break;
  await sleep(500);
}
await sleep(3000);
report.panelOpen = await measure();
report.panelOpenShot = await shot("electron-1-panel-open.png");

report.detailsClicked = await evaluate(`(() => {
  const toggle = [...document.querySelectorAll('[data-thread-panel-toggle]')].find((el) => el.getBoundingClientRect().width > 0);
  if (!toggle) return false;
  (toggle.matches('button') ? toggle : toggle.querySelector('button') || toggle).click();
  return true;
})()`);
await sleep(1500);
report.detailsOpen = await measure();
report.detailsOpenShot = await shot("electron-2-details-open.png");

client.close();
console.log(JSON.stringify(report, null, 1));
