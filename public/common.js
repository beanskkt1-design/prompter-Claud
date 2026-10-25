// 프롬프터 화면·리모콘이 같이 쓰는 코드
// 1) 방 코드 확인  2) 끊겨도 알아서 다시 붙는 연결
window.Prompter = (function () {
  const KEY = "prompter.room";

  function norm(r) {
    const s = String(r || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return s.length >= 4 && s.length <= 24 ? s : null;
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
  function load(k) { try { return localStorage.getItem(k); } catch { return null; } }

  // 주소의 ?room= → 없으면 이 기기에 저장된 방 → 그것도 없으면 시작 페이지로
  function getRoom() {
    const u = new URL(location.href);
    let r = norm(u.searchParams.get("room"));
    if (r) { store(KEY, r); return r; }
    r = norm(load(KEY));
    if (r) {
      u.searchParams.set("room", r);
      history.replaceState(null, "", u.pathname + u.search);
      return r;
    }
    location.replace("/?next=" + encodeURIComponent(location.pathname));
    return null;
  }

  // opts: { room, role, onMessage(msg), onState(state, downMs) }
  // state: "open" | "down"
  function connect(opts) {
    let ws = null, retryTimer = null, attempts = 0, lastMsg = 0, downSince = null;

    function open() {
      clearTimeout(retryTimer);
      const proto = location.protocol === "https:" ? "wss://" : "ws://";
      let s;
      try { s = new WebSocket(proto + location.host + "/?room=" + encodeURIComponent(opts.room)); }
      catch { return fail(); }
      ws = s;
      s.onopen = () => {
        if (ws !== s) return;
        attempts = 0; downSince = null; lastMsg = Date.now();
        s.send(JSON.stringify({ type: "hello", role: opts.role }));
        opts.onState("open", 0);
      };
      s.onmessage = (e) => {
        if (ws !== s) return;
        lastMsg = Date.now();
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === "pong") return;
        opts.onMessage(msg);
      };
      s.onclose = () => { if (ws === s) { ws = null; fail(); } };
      s.onerror = () => { try { s.close(); } catch {} };
    }

    function fail() {
      clearTimeout(retryTimer);
      if (!downSince) downSince = Date.now();
      opts.onState("down", Date.now() - downSince);
      attempts++;
      // 처음엔 빠르게, 길어지면 4초 간격으로 계속 재시도 (포기하지 않음)
      retryTimer = setTimeout(open, Math.min(800 * attempts, 4000));
    }

    // 끊긴 걸 모른 채 붙어 있는 "유령 연결"을 정리하고 바로 다시 붙기
    function kick() {
      const s = ws; ws = null;
      if (s) { s.onclose = null; try { s.close(); } catch {} }
      fail();
    }

    // 20초마다 신호를 보내 연결 유지 (무료 서버가 잠들지 않게)
    setInterval(() => {
      if (ws && ws.readyState === 1) { try { ws.send('{"type":"ping"}'); } catch {} }
    }, 20000);

    // 50초 동안 서버에서 아무 소식이 없으면 끊긴 것으로 보고 다시 연결
    setInterval(() => {
      if (ws && ws.readyState === 1 && Date.now() - lastMsg > 50000) kick();
    }, 5000);

    // 화면을 다시 켰을 때, 와이파이↔LTE가 바뀌었을 때 즉시 확인
    function recheck() {
      if (!ws) { attempts = 0; open(); return; }
      if (ws.readyState === 1) {
        try { ws.send('{"type":"ping"}'); } catch {}
        // 3초 안에 답이 없으면 유령 연결로 판단
        const sent = Date.now();
        setTimeout(() => { if (ws && lastMsg < sent) kick(); }, 3000);
      }
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") recheck(); });
    window.addEventListener("online", recheck);
    window.addEventListener("pageshow", recheck);

    open();

    return {
      send(obj) {
        if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
        return false;
      },
      isOpen() { return !!(ws && ws.readyState === 1); },
    };
  }

  return { getRoom, connect, norm, store, load };
})();
