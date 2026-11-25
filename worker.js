const DB_URL = process.env.FIREBASE_DB_URL;
const DB_SECRET = process.env.FIREBASE_DB_SECRET || "";
const SECRET_TOKEN = process.env.MY_SECRET_TOKEN || "";

const MAX_HOURS = Math.max(0.1, Math.min(parseFloat(process.env.RUN_HOURS || "1"), 5));
const DELAY_MS = Math.max(500, parseInt(process.env.DELAY_MS || "1500", 10));
const RUN_NOTE = process.env.RUN_NOTE || "Phiên tự động";
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

// Giữ tối đa 150 dòng log gần nhất để Firebase luôn nhẹ
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
// CHỖ GẮN TÁC VỤ CÁ NHÂN CỦA ÔNG
// Trả về: { ok: boolean, item: string, value: number, points: number, detail: string }
// =========================================================================
async function executeSingleCycle(token) {
  const t0 = Date.now();

  // Ví dụ khung xử lý: thay bằng request API thực tế của ông
  await sleep(800);
  const latency = Date.now() - t0;

  return {
    ok: true,
    item: "Mục mẫu A",
    value: 15,
    points: 2,
    latency,
    detail: "Hoàn thành chu kỳ xử lý"
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
      const result = await executeSingleCycle(SECRET_TOKEN);

      if (result.ok) {
        okCount++;
        totalLatency += result.latency || 0;
        const avgLat = Math.round(totalLatency / okCount);

        // Cập nhật cộng dồn theo từng loại vào worker_items để load bảng cực nhanh
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
          `${result.item} (+${result.value} giá trị, +${result.points} điểm) — ${result.detail}`,
          result.latency
        );
      } else {
        errCount++;
        await fbPatch("worker_control", {
          status: "running",
          last_heartbeat: Date.now(),
          err_count: errCount
        });
        await pushLog("WARN", `Chu kỳ thất bại: ${result.detail || "Không rõ nguyên nhân"}`);
      }
    } catch (err) {
      errCount++;
      await fbPatch("worker_control", {
        status: "running",
        last_heartbeat: Date.now(),
        err_count: errCount
      });
      await pushLog("ERROR", `Lỗi ngoại lệ: ${err.message}`);
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
  await pushLog("INFO", `Kết thúc phiên chạy. Thành công: ${okCount} | Lỗi: ${errCount}`);
})();
