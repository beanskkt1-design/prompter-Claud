// 프롬프터 서버 (클라우드/로컬 겸용)
// - 정적 페이지(/, /display, /remote)를 서빙하고
// - WebSocket으로 같은 "방(room)"에 들어온 프롬프터 화면과 리모콘을 실시간으로 이어준다.
// - 방 코드가 다르면 서로 완전히 분리된다. (주소를 아는 다른 사람이 내 대본을 볼 수 없음)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");
let QRCode = null;
try { QRCode = require("qrcode"); } catch { /* qrcode 없으면 QR 없이 동작 */ }

const PORT = process.env.PORT || 4173;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

// 배포된 버전 확인용. 코드 바꿀 때마다 올린다.
const BUILD = "2026-10-26-cloud-rooms";

// 방 코드: 영문/숫자 4~24자, 대문자로 통일
function normRoom(r) {
  const s = String(r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length >= 4 && s.length <= 24 ? s : null;
}

function lanIP() {
  const ifaces = os.networkInterfaces();
  const cands = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family !== "IPv4" && i.family !== 4) continue;
      if (i.internal || i.address.startsWith("169.254.")) continue;
      let score = 0;
      if (/^192\.168\./.test(i.address)) score += 3;
      else if (/^10\./.test(i.address)) score += 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(i.address)) score += 1;
      if (/vEthernet|WSL|VirtualBox|VMware|Hyper-V|docker|utun|bridge|vbox|Loopback/i.test(name)) score -= 10;
      if (/^(en0|en1|Wi-?Fi|wlan|eth0|Ethernet|이더넷)/i.test(name)) score += 1;
      cands.push({ address: i.address, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.length ? cands[0].address : "localhost";
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(file);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (ext === ".html" || ext === ".webmanifest") headers["Cache-Control"] = "no-store, must-revalidate";
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  if (p === "/version" || p === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(BUILD);
    return;
  }

  if (p === "/" || p === "/index.html") return sendFile(res, path.join(PUBLIC, "index.html"));
  if (p === "/display" || p === "/display.html") return sendFile(res, path.join(PUBLIC, "display.html"));
  if (p === "/remote" || p === "/remote.html") return sendFile(res, path.join(PUBLIC, "remote.html"));

  // 접속용 주소 + QR 코드(JSON). ?room=코드
  if (p === "/api/info") {
    const room = normRoom(url.searchParams.get("room"));
    const proto = (req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http")).split(",")[0].trim();
    let host = req.headers.host || `${lanIP()}:${PORT}`;
    if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) host = `${lanIP()}:${PORT}`;
    const base = `${proto}://${host}`;
    const q = room ? `?room=${room}` : "";
    const info = { base, room, display: `${base}/display${q}`, remote: `${base}/remote${q}` };
    if (QRCode) {
      try {
        info.displayQR = await QRCode.toDataURL(info.display, { margin: 1, width: 240 });
        info.remoteQR = await QRCode.toDataURL(info.remote, { margin: 1, width: 240 });
      } catch { /* ignore */ }
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(info));
    return;
  }

  // 그 외 정적 파일 (public 폴더 밖으로 못 나가게)
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  return sendFile(res, file);
});

// ── WebSocket 릴레이 (방 단위) ───────────────────────────────────
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

// rooms: 코드 → { clients:Set, script, status, touched }
const rooms = new Map();
function getRoom(code) {
  let r = rooms.get(code);
  if (!r) { r = { clients: new Set(), script: null, status: null, touched: Date.now() }; rooms.set(code, r); }
  r.touched = Date.now();
  return r;
}

function broadcast(room, sender, msg) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c !== sender && c.readyState === 1) c.send(data);
  }
}

// 이 방에 프롬프터 화면/리모콘이 몇 대 붙어 있는지 모두에게 알림
function sendPresence(room) {
  let display = 0, remote = 0;
  for (const c of room.clients) {
    if (c.role === "display") display++;
    else if (c.role === "remote") remote++;
  }
  broadcast(room, null, { type: "presence", display, remote });
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  const code = normRoom(url.searchParams.get("room"));
  if (!code) { ws.close(4000, "room required"); return; }

  const room = getRoom(code);
  room.clients.add(ws);
  ws.role = "unknown";
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    room.touched = Date.now();

    switch (msg.type) {
      case "ping":
        // 연결 유지용. 서버가 잠들지 않게 + 죽은 연결을 빨리 알아차리게
        if (ws.readyState === 1) ws.send('{"type":"pong"}');
        break;
      case "hello":
        ws.role = msg.role === "display" || msg.role === "remote" ? msg.role : "unknown";
        // 서버에 저장된 대본/상태를 새로 들어온 기기에 전달
        ws.send(JSON.stringify({ type: "welcome", room: code, hasScript: !!room.script, build: BUILD }));
        if (room.script) ws.send(JSON.stringify(room.script));
        if (room.status) ws.send(JSON.stringify(room.status));
        if (ws.role === "remote") broadcast(room, ws, { type: "sync-request" });
        sendPresence(room);
        break;
      case "script":
        room.script = { type: "script", text: String(msg.text || "") };
        broadcast(room, ws, room.script);
        break;
      case "status":
        room.status = { ...msg, type: "status" };
        broadcast(room, ws, room.status);
        break;
      case "control":
      case "sync-request":
        broadcast(room, ws, msg);
        break;
      default:
        break; // 모르는 메시지는 무시
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    sendPresence(room);
  });
});

// 25초마다 생존 확인: 응답 없는 연결은 정리(유령 연결 방지)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 25000);

// 12시간 동안 아무도 없는 방은 메모리에서 정리
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.clients.size === 0 && now - r.touched > 12 * 3600 * 1000) rooms.delete(code);
  }
}, 30 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`프롬프터 서버 실행 중 (build ${BUILD})`);
  console.log(`  이 기기:  http://localhost:${PORT}`);
  console.log(`  같은 와이파이의 다른 기기: http://${lanIP()}:${PORT}`);
});
