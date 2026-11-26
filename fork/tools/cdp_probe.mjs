// Read-only probe of a running Electron app over the Chrome DevTools Protocol.
// usage: node cdp_probe.mjs <port> probe|text|close
const [port, mode = "probe"] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

if (mode === "close") {
  const version = await (await fetch(`${base}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  // The browser closes the socket before it can answer; give it a moment and exit.
  void browser.send("Browser.close");
  await sleep(1000);
  process.exit(0);
}

const deadline = Date.now() + 90_000;
let page;
while (Date.now() < deadline) {
  try {
    const targets = await (await fetch(`${base}/json/list`)).json();
    page = targets.find((t) => t.type === "page" && t.url.startsWith("t3code://app"));
    if (page) break;
  } catch {}
  await sleep(500);
}
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
  return r.result?.result?.value;
};
if (mode === "text") {
  // The window's visible text plus link targets, for checking that a profile's data shows up.
  console.log(
    JSON.stringify(
      await evaluate(`({ text: document.body.innerText,
    hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) })`),
    ),
  );
  client.close();
  process.exit(0);
}
let state;
while (Date.now() < deadline) {
  state = await evaluate(`(() => ({
    readyState: document.readyState,
    textLength: document.body ? document.body.innerText.length : 0,
    links: document.querySelectorAll('a[href]').length,
  }))()`);
  if (state?.readyState === "complete" && state.textLength > 200) break;
  await sleep(500);
}
await sleep(5000); // let lazy routes settle before measuring
const report = await evaluate(`(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const js = res.filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'));
  const sum = (xs, k) => xs.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    href: location.href,
    title: document.title,
    viteClient: !!document.querySelector('script[src*="@vite/client"]') || res.some((r) => r.name.includes('/@vite/')),
    reactRefreshPreamble: typeof window.__vite_plugin_react_preamble_installed__ !== 'undefined',
    navigation: nav ? { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd) } : null,
    jsRequests: js.length,
    jsDecodedBytes: sum(js, 'decodedBodySize'),
    jsEncodedBytes: sum(js, 'encodedBodySize'),
    textLength: document.body.innerText.length,
    sidebarLinks: document.querySelectorAll('a[href]').length,
    jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
})()`);
// React 19 production builds strip the dev-only "react-stack-bottom-frame" and $$typeof debug info.
report.reactDevBuild = await evaluate(`(() => {
  const el = document.getElementById('root') || document.body.firstElementChild;
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactContainer$'));
  const fiber = key ? el[key] : null;
  const child = fiber && (fiber.child || fiber.stateNode?.current?.child);
  return child ? ('_debugOwner' in child || '_debugInfo' in child || '_debugStack' in child) : 'no-fiber';
})()`);
client.close();
console.log(JSON.stringify(report));
