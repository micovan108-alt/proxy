const DB_URL = process.env.FIREBASE_DB_URL || "https://chat-4e280-default-rtdb.firebaseio.com";
const DB_SECRET = process.env.FIREBASE_DB_SECRET || "";
const INITIAL_REFRESH_TOKEN = process.env.MY_REFRESH_TOKEN || "3z7r7ttgceht";

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

function dbEndpoint(path) {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return DB_SECRET
    ? `${DB_URL}/${clean}.json?auth=${encodeURIComponent(DB_SECRET)}`
    : `${DB_URL}/${clean}.json`;
}

async function fbGet(path) {
  const res = await fetch(dbEndpoint(path));
  return res.ok ? res.json() : null;
}

async function fbPatch(path, data) {
  await fetch(dbEndpoint(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

async function fbPost(path, data) {
  await fetch(dbEndpoint(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}

async function pushLog(level, msg, latency = null) {
  const entry = {
    ts: Date.now(),
    level, // INFO | SUCCESS | WARN | ERROR
    msg,
    latency,
    run_id: RUN_ID
  };
  console.log(`[${level}] ${msg}`);
  await fbPost("worker_logs", entry);
}

async function pruneOldLogs(keep = 150) {
  const res = await fetch(`${dbEndpoint("worker_logs")}${DB_SECRET ? "&" : "?"}shallow=true`);
  if (!res.ok) return;
  const keys = Object.keys((await res.json()) || {}).sort();
  if (keys.length <= keep) return;
  const toDelete = keys.slice(0, keys.length - keep);
  const patchObj = {};
  for (const k of toDelete) patchObj[k] = null;
  await fbPatch("worker_logs", patchObj);
}

// =========================================================================
// TỰ ĐỘNG GIA HẠN & XOAY VÒNG REFRESH TOKEN TRÊN FIREBASE
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

  const currentRefresh = authData.refresh_token || INITIAL_REFRESH_TOKEN;
  if (!currentRefresh) {
    throw new Error("Không tìm thấy refresh_token để gia hạn phiên!");
  }

  let lastErr = "";
  for (const url of AUTH_ENDPOINTS) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": APIKEY,
        "Origin": "https://play.lazi.vn",
        "Referer": "https://play.lazi.vn/lobby"
      },
      body: JSON.stringify({ refresh_token: currentRefresh })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.access_token && data.refresh_token) {
      await fbPatch("worker_auth", {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        updated_at: Date.now()
      });
      await pushLog("INFO", "Đã tự động làm mới cặp access_token & refresh_token.");
      return data.access_token;
    }
    lastErr = `(${res.status}) ${JSON.stringify(data)}`;
  }

  throw new Error(`Gia hạn token thất bại: ${lastErr}`);
}

async function rpc(name, body, token) {
  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Profile": "public",
      "apikey": APIKEY,
      "Authorization": `Bearer ${token}`,
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
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
  return { status: res.status, data };
}

// =========================================================================
// LUỒNG CÂU CÁ THẬT (CAST -> ĐỢI BITE + FIGHT -> LAND)
// =========================================================================
async function executeSingleCycle() {
  let token = await getValidToken(false);
  const t0 = Date.now();

  let castRes = await rpc("fishing_cast", { p_rod: null }, token);

  // Nếu token vừa hết hạn đột xuất thì ép đổi token mới và thả câu lại ngay
  if (castRes.status === 401 || castRes.status === 403) {
    token = await getValidToken(true);
    castRes = await rpc("fishing_cast", { p_rod: null }, token);
  }

  if (castRes.status !== 200 || !castRes.data?.cast) {
    return {
      ok: false,
      detail: `Thả câu thất bại (${castRes.status}): ${JSON.stringify(castRes.data)}`
    };
  }

  const { cast, bite_ms = 2000, fight_ms = 1500, fish_tier } = castRes.data;

  await sleep(bite_ms + fight_ms + 250);

  const landRes = await rpc("fishing_land", { p_cast: cast, p_ok: true }, token);
  const latency = Date.now() - t0;

  if (landRes.status !== 200 || !landRes.data) {
    return {
      ok: false,
      detail: `Kéo cá lỗi (${landRes.status}): ${JSON.stringify(landRes.data)}`
    };
  }

  const d = landRes.data;
  if (d.result !== "caught") {
    return {
      ok: false,
      detail: `Trượt mất rồi (result=${d.result || "unknown"})`
    };
  }

  const fishName =
    d.name ||
    d.fish_name ||
    `Cá Tier ${fish_tier ?? 1} (Hiếm ${d.rarity ?? 0})`;

  return {
    ok: true,
    item: fishName,
    value: Number(d.value || 0),
    points: Number(d.points || 0),
    latency,
    detail: `Dài ${d.size ?? "?"}m | Nặng ${d.weight ?? "?"}kg | Túi: ${d.count ?? "?"} con | Điểm tổng: ${d.score ?? "?"}`
  };
}

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

  await pushLog("INFO", `Khởi động worker #${RUN_ID} (${MAX_HOURS}h) — ${RUN_NOTE}`);

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

    try {
      const result = await executeSingleCycle();

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
          `${result.item} (+${result.value} xu, +${result.points} điểm) — ${result.detail}`,
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
      await pushLog("ERROR", `Lỗi nghiêm trọng: ${err.message}`);

      // Nếu bản thân refresh_token bị thu hồi hoặc hết hạn hẳn thì dừng luôn cho đỡ đốt phút GitHub
      if (err.message.includes("Gia hạn token thất bại")) {
        break;
      }
    }

    loopIndex++;
    if (loopIndex % 25 === 0) {
      await pruneOldLogs(150);
    }

    await sleep(DELAY_MS);
  }

  await fbPatch("worker_control", {
    status: "idle",
    paused: false,
    last_heartbeat: Date.now()
  });
  await pushLog("INFO", `Kết thúc phiên chạy. Dính cá: ${okCount} | Hụt/Lỗi: ${errCount}`);
})();
      
