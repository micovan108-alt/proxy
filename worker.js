const puppeteer = require("puppeteer");

const DB_URL = process.env.FIREBASE_DB_URL || "https://chat-4e280-default-rtdb.firebaseio.com";
const DB_SECRET = process.env.FIREBASE_DB_SECRET || "";
const LAZI_COOKIE = process.env.LAZI_COOKIE || "";

const BASE = "https://play.lazi.vn/rest/v1/rpc";
const AUTH_ENDPOINTS = [
  "https://play.lazi.vn/auth/v1/token?grant_type=refresh_token",
  "https://vvyohpqnvxxyxygscxsj.supabase.co/auth/v1/token?grant_type=refresh_token"
];
const APIKEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzk1MzIxNzY4LCJleHAiOjIxMTA2ODE3Njh9.TFy0zQvn7fXnwbaniwb4yvfBfdLp3SXD59pG6w9QQjg";

const MAX_HOURS = Math.max(0.1, Math.min(parseFloat(process.env.RUN_HOURS || "1"), 5));
const DELAY_MS = Math.max(500, parseInt(process.env.DELAY_MS || "1500", 10));
const RUN_NOTE = process.env.RUN_NOTE || "Treo câu cá tự động";
const RUN_ID = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const END_TIME = Date.now() + MAX_HOURS * 3600 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// =========================================================================
// FIREBASE REALTIME DATABASE HELPERS (CÓ CHỐNG RỚT MẠNG)
// =========================================================================
function dbEndpoint(path) {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return DB_SECRET
    ? `${DB_URL}/${clean}.json?auth=${encodeURIComponent(DB_SECRET)}`
    : `${DB_URL}/${clean}.json`;
}

async function fbGet(path) {
  try {
    const res = await fetch(dbEndpoint(path));
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

async function fbPatch(path, data) {
  try {
    await fetch(dbEndpoint(path), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.error(`[FB_PATCH_ERR] ${path}:`, e.message);
  }
}

async function fbPost(path, data) {
  try {
    await fetch(dbEndpoint(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch (e) {
    console.error(`[FB_POST_ERR] ${path}:`, e.message);
  }
}

async function pushLog(level, msg, latency = null) {
  const entry = {
    ts: Date.now(),
    level, // INFO | SUCCESS | WARN | ERROR
    msg,
    latency,
    run_id: RUN_ID
  };
  const latStr = latency !== null ? ` (${latency}ms)` : "";
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}${latStr}`);
  await fbPost("worker_logs", entry);
}

async function pruneOldLogs(keep = 180) {
  try {
    const res = await fetch(`${dbEndpoint("worker_logs")}${DB_SECRET ? "&" : "?"}shallow=true`);
    if (!res.ok) return;
    const keys = Object.keys((await res.json()) || {}).sort();
    if (keys.length <= keep) return;
    const toDelete = keys.slice(0, keys.length - keep);
    const patchObj = {};
    for (const k of toDelete) patchObj[k] = null;
    await fbPatch("worker_logs", patchObj);
  } catch {}
}

// =========================================================================
// PUPPETEER SSO EXTRACTOR (BẮT GÓI TIN MẠNG + QUÉT STORAGE + LOG CHI TIẾT)
// =========================================================================
async function fetchTokensViaPuppeteer() {
  if (!LAZI_COOKIE || !LAZI_COOKIE.trim()) {
    throw new Error("Biến LAZI_COOKIE trong GitHub Secrets đang trống!");
  }

  const tStart = Date.now();
  await pushLog("INFO", "[SSO 1/5] Khởi chạy Chromium Headless trên runner...");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768"
    ]
  });

  try {
    const page = await browser.newPage();

    // Ẩn dấu vết webdriver & dùng đúng User-Agent Chrome Linux khớp với engine
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
    });

    // Chỉ chặn ảnh/font/media để nhẹ RAM, giữ nguyên CSS & JS để SPA không bị treo
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Lớp 1: Nghe lén trực tiếp response API nhả access_token & refresh_token
    let interceptedSession = null;
    page.on("response", async (res) => {
      try {
        const url = res.url();
        if (url.includes("token") || url.includes("auth") || url.includes("verify") || url.includes("otp")) {
          const ct = res.headers()["content-type"] || "";
          if (ct.includes("application/json")) {
            const json = await res.json().catch(() => null);
            const s = json?.session || json?.data?.session || json;
            if (s && s.access_token && s.refresh_token) {
              interceptedSession = {
                access_token: s.access_token,
                refresh_token: s.refresh_token,
                source: `Network (${url.split("?")[0]})`
              };
            }
          }
        }
      } catch {}
    });

    // Parse & nạp cookie vào cả domain gốc .lazi.vn
    const rawPairs = LAZI_COOKIE.split(";").map((p) => p.trim()).filter(Boolean);
    const cookies = [];
    for (const pair of rawPairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx <= 0) continue;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      cookies.push({
        name,
        value,
        domain: ".lazi.vn",
        path: "/",
        secure: true
      });
    }

    await page.setCookie(...cookies);
    await pushLog("INFO", `[SSO 2/5] Đã nạp ${cookies.length} cookie vào trình duyệt ảo.`);

    // Bước đệm: Vào trang chủ lazi.vn để kích hoạt & xác minh cookie gốc còn sống
    const resMain = await page.goto("https://lazi.vn/", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    const mainStatus = resMain ? resMain.status() : "N/A";
    const isLoggedInLazi = await page.evaluate(() => {
      const html = document.body ? document.body.innerHTML : "";
      return html.includes("4253820") || html.includes("tien-nam") || html.includes("logout");
    });
    await pushLog(
      "INFO",
      `[SSO 3/5] Mở lazi.vn (HTTP ${mainStatus}) | Nhận diện đăng nhập gốc: ${isLoggedInLazi ? "CÓ" : "KHÔNG THẤY"}`
    );

    // Bước chính: Vào sảnh game play.lazi.vn/lobby để kích hoạt cầu nối SSO sang Supabase
    const resLobby = await page.goto("https://play.lazi.vn/lobby", {
      waitUntil: "networkidle2",
      timeout: 45000
    });
    const lobbyStatus = resLobby ? resLobby.status() : "N/A";
    await pushLog(
      "INFO",
      `[SSO 4/5] Mở play.lazi.vn/lobby (HTTP ${lobbyStatus}) -> URL hiện tại: ${page.url()}`
    );

    // Chờ tối đa 20 giây cho tới khi bắt được token từ Network hoặc Storage
    let session = null;
    for (let i = 1; i <= 20; i++) {
      if (interceptedSession) {
        session = interceptedSession;
        break;
      }

      session = await page.evaluate(() => {
        const stores = [
          { name: "localStorage", obj: window.localStorage },
          { name: "sessionStorage", obj: window.sessionStorage }
        ];
        for (const st of stores) {
          try {
            for (let j = 0; j < st.obj.length; j++) {
              const k = st.obj.key(j);
              const v = st.obj.getItem(k);
              if (k.includes("auth-token") || (v && v.includes("access_token"))) {
                const parsed = JSON.parse(v);
                const s = parsed.currentSession || parsed.session || parsed;
                if (s && s.access_token && s.refresh_token) {
                  return {
                    access_token: s.access_token,
                    refresh_token: s.refresh_token,
                    source: `${st.name} (${k})`
                  };
                }
              }
            }
          } catch {}
        }
        return null;
      });

      if (session) break;
      await sleep(1000);
    }

    if (!session) {
      const diag = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        lsKeys: Object.keys(localStorage),
        ssKeys: Object.keys(sessionStorage),
        bodyPreview: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 160)
      }));
      throw new Error(
        `Không bắt được token sau 20s | URL=${diag.url} | Title="${diag.title}" | LS=${JSON.stringify(diag.lsKeys)} | Text="${diag.bodyPreview}"`
      );
    }

    // Lưu cặp token mới lên Firebase để xoay vòng
    await fbPatch("worker_auth", {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: Date.now() + 3300 * 1000,
      updated_at: Date.now(),
      source: session.source
    });

    await pushLog(
      "INFO",
      `[SSO 5/5] Bắt thành công token từ ${session.source} | Refresh: ${session.refresh_token.slice(0, 6)}***`,
      Date.now() - tStart
    );

    return session.access_token;
  } finally {
    await browser.close();
  }
}

// =========================================================================
// QUẢN LÝ TOKEN: DÙNG CACHE -> ĐỔI QUA API -> LỖI THÌ GỌI PUPPETEER
// =========================================================================
async function getValidToken(forceRefresh = false) {
  const authData = (await fbGet("worker_auth")) || {};

  if (
    !forceRefresh &&
    authData.access_token &&
    authData.expires_at &&
    Date.now() < authData.expires_at - 180000
  ) {
    return authData.access_token;
  }

  if (authData.refresh_token) {
    for (const url of AUTH_ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": APIKEY,
            "Origin": "https://play.lazi.vn",
            "Referer": "https://play.lazi.vn/lobby"
          },
          body: JSON.stringify({ refresh_token: authData.refresh_token })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.access_token && data.refresh_token) {
          await fbPatch("worker_auth", {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + (data.expires_in || 3600) * 1000,
            updated_at: Date.now(),
            source: "API Refresh"
          });
          await pushLog(
            "INFO",
            `Đã gia hạn nhanh token qua API (Refresh mới: ${data.refresh_token.slice(0, 6)}***).`
          );
          return data.access_token;
        }
      } catch {}
    }
    await pushLog("WARN", "Refresh token trên Firebase đã hết hiệu lực, gọi Puppeteer lấy lại phiên mới...");
  }

  return await fetchTokensViaPuppeteer();
}

// =========================================================================
// GỌI RPC GAME & XỬ LÝ CHU KỲ CÂU CÁ CHI TIẾT
// =========================================================================
async function rpc(name, body, token) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Profile": "public",
      "apikey": APIKEY,
      "Authorization": `Bearer ${token}`,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Referer": "https://play.lazi.vn/lobby",
      "Origin": "https://play.lazi.vn"
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, ms: Date.now() - t0 };
}

async function executeSingleCycle(cycleNum) {
  let token = await getValidToken(false);
  const tCycle = Date.now();

  // Pha 1: Thả câu
  let castRes = await rpc("fishing_cast", { p_rod: null }, token);

  if (castRes.status === 401 || castRes.status === 403) {
    await pushLog("WARN", `Vòng #${cycleNum}: Token bị từ chối (${castRes.status}), đang làm mới...`);
    token = await getValidToken(true);
    castRes = await rpc("fishing_cast", { p_rod: null }, token);
  }

  if (castRes.status !== 200 || !castRes.data?.cast) {
    return {
      ok: false,
      detail: `Vòng #${cycleNum} | Thả câu lỗi (HTTP ${castRes.status}): ${JSON.stringify(castRes.data)}`
    };
  }

  const { cast, bite_ms = 2000, fight_ms = 1500, fish_tier } = castRes.data;
  const waitTotal = bite_ms + fight_ms + 250;

  // Pha 2: Chờ cá cắn câu & giằng co
  await sleep(waitTotal);

  // Pha 3: Giật cần kéo cá
  const landRes = await rpc("fishing_land", { p_cast: cast, p_ok: true }, token);
  const totalLatency = Date.now() - tCycle;

  if (landRes.status !== 200 || !landRes.data) {
    return {
      ok: false,
      detail: `Vòng #${cycleNum} | Kéo cá lỗi (HTTP ${landRes.status}): ${JSON.stringify(landRes.data)}`
    };
  }

  const d = landRes.data;
  if (d.result !== "caught") {
    return {
      ok: false,
      detail: `Vòng #${cycleNum} | Cá sổng mất (result=${d.result || "unknown"}, tier=${fish_tier ?? "?"})`
    };
  }

  const fishName = d.name || d.fish_name || `Cá Tier ${fish_tier ?? 1} (Hiếm ${d.rarity ?? 0})`;

  return {
    ok: true,
    item: fishName,
    value: Number(d.value || 0),
    points: Number(d.points || 0),
    latency: totalLatency,
    detail: `#${cycleNum} | ${d.size ?? "?"}m - ${d.weight ?? "?"}kg | Túi: ${d.count ?? "?"} | Điểm tổng: ${d.score ?? "?"} | Cast:${castRes.ms}ms + Chờ:${waitTotal}ms + Land:${landRes.ms}ms`
  };
}

// =========================================================================
// VÒNG LẶP CHÍNH
// =========================================================================
(async () => {
  let okCount = 0;
  let errCount = 0;
  let totalLatency = 0;

  await fbPatch("worker_control", {
    status: "running",
    stop: false,
    paused: false,
    run_id: RUN_ID,
    note: RUN_NOTE,
    started_at: Date.now(),
    ends_at: END_TIME,
    last_heartbeat: Date.now(),
    ok_count: 0,
    err_count: 0,
    avg_latency: 0
  });

  await pushLog("INFO", `=== KHỞI ĐỘNG WORKER #${RUN_ID} (${MAX_HOURS}h, delay ${DELAY_MS}ms) — ${RUN_NOTE} ===`);

  try {
    await fetchTokensViaPuppeteer();
  } catch (err) {
    await pushLog("ERROR", `Dừng worker do lỗi khởi tạo phiên: ${err.message}`);
    await fbPatch("worker_control", { status: "idle", last_heartbeat: Date.now() });
    return;
  }

  let loopIndex = 0;
  while (Date.now() < END_TIME) {
    const ctrl = (await fbGet("worker_control")) || {};

    if (ctrl.stop === true) {
      await pushLog("WARN", "Nhận lệnh DỪNG KHẨN CẤP từ bảng điều khiển.");
      break;
    }

    if (ctrl.paused === true) {
      await fbPatch("worker_control", { status: "paused", last_heartbeat: Date.now() });
      await sleep(3000);
      continue;
    }

    loopIndex++;
    try {
      const result = await executeSingleCycle(loopIndex);

      if (result.ok) {
        okCount++;
        totalLatency += result.latency || 0;
        const avgLat = Math.round(totalLatency / okCount);

        const safeKey = (result.item || "Khác").replace(/[.#$/\[\]]/g, "_");
        const curItem = (await fbGet(`worker_items/${safeKey}`)) || {
          name: result.item || "Khác",
          count: 0,
          total_value: 0,
          total_points: 0
        };

        await fbPatch(`worker_items/${safeKey}`, {
          name: result.item || "Khác",
          count: curItem.count + 1,
          total_value: curItem.total_value + Number(result.value || 0),
          total_points: curItem.total_points + Number(result.points || 0),
          last_seen: Date.now()
        });

        await fbPatch("worker_control", {
          status: "running",
          last_heartbeat: Date.now(),
          ok_count: okCount,
          err_count: errCount,
          avg_latency: avgLat
        });

        await pushLog(
          "SUCCESS",
          `${result.item} (+${result.value} xu, +${result.points}đ) — ${result.detail}`,
          result.latency
        );
      } else {
        errCount++;
        await fbPatch("worker_control", {
          status: "running",
          last_heartbeat: Date.now(),
          err_count: errCount
        });
        await pushLog("WARN", result.detail || "Chu kỳ thất bại");
      }
    } catch (err) {
      errCount++;
      await fbPatch("worker_control", {
        status: "running",
        last_heartbeat: Date.now(),
        err_count: errCount
      });
      await pushLog("ERROR", `Vòng #${loopIndex} gặp ngoại lệ: ${err.message}`);
    }

    if (loopIndex % 25 === 0) {
      await pruneOldLogs(180);
    }

    await sleep(DELAY_MS);
  }

  await fbPatch("worker_control", {
    status: "idle",
    paused: false,
    last_heartbeat: Date.now()
  });
  await pushLog("INFO", `=== KẾT THÚC PHIÊN #${RUN_ID} | Dính cá: ${okCount} | Hụt/Lỗi: ${errCount} ===`);
})();
                
