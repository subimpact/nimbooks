#!/usr/bin/env python3
"""Verify NimBooks demo seed: receipts + invoice + History memo display."""
import json, time, urllib.request, websocket  # noqa

CDP = "ws://localhost:9222/devtools/page/nimbooks-seed"

def connect():
    # find a page target, or create one
    tabs = json.load(urllib.request.urlopen("http://localhost:9222/json"))
    for t in tabs:
        if t.get("type") == "page":
            return websocket.create_connection(t["webSocketDebuggerUrl"], timeout=30)
    raise RuntimeError("no page target")

ws = connect()
msg_id = 0
def cmd(method, params=None):
    global msg_id
    msg_id += 1
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    while True:
        r = json.loads(ws.recv())
        if r.get("id") == msg_id:
            return r.get("result", {})

# Navigate to the app
cmd("Page.enable")
cmd("Runtime.enable")
cmd("Page.navigate", {"url": "https://nimbooks.subimpact.net/?cb=seed-verify"})
time.sleep(4)

# Seed localStorage
seed = open("/tmp/nimbooks-demo-seed.js").read()
expr = f"""
(() => {{
  {seed}
  return 'seeded';
}})()
"""
r = cmd("Runtime.evaluate", {"expression": expr, "returnByValue": True})
print("SEED:", r.get("result", {}).get("value"))

# Reload so the app picks up the seeded data
cmd("Page.reload")
time.sleep(4)

# Enter demo mode: click "Try with a sample wallet"
r = cmd("Runtime.evaluate", {"expression": """
(() => {
  const btns = [...document.querySelectorAll('button')];
  const demo = btns.find(b => b.textContent.includes('sample wallet'));
  if (demo) { demo.click(); return 'clicked demo'; }
  return 'demo button not found: ' + btns.map(b=>b.textContent).slice(0,8).join(' | ');
})()
""", "returnByValue": True})
print("DEMO:", r.get("result", {}).get("value"))
time.sleep(5)

# Check Receipts tab
r = cmd("Runtime.evaluate", {"expression": """
(() => {
  const tabs = [...document.querySelectorAll('button')];
  const rec = tabs.find(b => b.textContent.trim() === 'Receipts');
  if (rec) rec.click();
  return 'clicked receipts';
})()
""", "returnByValue": True})
print("TAB:", r.get("result", {}).get("value"))
time.sleep(2)

r = cmd("Runtime.evaluate", {"expression": """
(() => {
  const cards = [...document.querySelectorAll('.receipt')];
  return cards.map(c => c.textContent.replace(/\\s+/g, ' ').trim());
})()
""", "returnByValue": True})
print("RECEIPTS:", json.dumps(r.get("result", {}).get("value"), indent=1))

# Check Request tab
r = cmd("Runtime.evaluate", {"expression": """
(() => {
  const tabs = [...document.querySelectorAll('button')];
  const req = tabs.find(b => b.textContent.trim() === 'Request');
  if (req) req.click();
  return 'clicked request';
})()
""", "returnByValue": True})
time.sleep(2)
r = cmd("Runtime.evaluate", {"expression": """
(() => {
  const cards = [...document.querySelectorAll('.invoice-item')];
  return cards.map(c => c.textContent.replace(/\\s+/g, ' ').trim());
})()
""", "returnByValue": True})
print("REQUESTS:", json.dumps(r.get("result", {}).get("value"), indent=1))

# Check History memo display
r = cmd("Runtime.evaluate", {"expression": """
(() => {
  const tabs = [...document.querySelectorAll('button')];
  const hist = tabs.find(b => b.textContent.trim() === 'History');
  if (hist) hist.click();
  return 'clicked history';
})()
""", "returnByValue": True})
time.sleep(3)
r = cmd("Runtime.evaluate", {"expression": """
(() => {
  const memos = [...document.querySelectorAll('.tx-memo')];
  return memos.map(m => m.textContent.replace(/\\s+/g, ' ').trim());
})()
""", "returnByValue": True})
print("HISTORY MEMOS:", json.dumps(r.get("result", {}).get("value"), indent=1))

ws.close()
