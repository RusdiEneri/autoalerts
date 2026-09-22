import axios from "axios";
import { parseStringPromise } from "xml2js";
import { RSS_URL, PROVINCES_FILTER } from "./config.js";
import { getAlertKey, readHistory, isAlertActive } from "./storage.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse RSS XML -> array alert { title, link, description, pubDate }
async function fetchRSS() {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await axios.get(RSS_URL, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AutoAlerts/1.0; +https://github.com/)",
          Accept: "application/xml, text/xml",
        },
      });
      const parsed = await parseStringPromise(res.data, { explicitArray: false });
      const items = parsed?.rss?.channel?.item || [];
      const list = Array.isArray(items) ? items : [items];
      return list.map((item) => ({
        title: item.title,
        link: item.link,
        description: item.description,
        pubDate: item.pubDate,
        author: item.author || item["dc:creator"],
      }));
    } catch (err) {
      console.error(`Gagal fetch RSS (attempt ${attempt + 1}):`, err.message);
      if (attempt < maxRetries - 1) await sleep(3000);
    }
  }

  return [];
}

// Parse CAP XML detail dari URL -> object alert lengkap dengan retry
async function fetchCAPDetail(capUrl) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await axios.get(capUrl, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AutoAlerts/1.0)",
          Accept: "application/xml, text/xml",
        },
      });

      const parsed = await parseStringPromise(res.data, { explicitArray: false });
      const alert = parsed?.alert;
      if (!alert) {
        console.error(`CAP ${capUrl}: struktur tidak valid`);
        return null;
      }

      const info = Array.isArray(alert.info) ? alert.info[0] : alert.info;
      const area = info?.area || {};
      return {
        identifier: alert.identifier,
        sender: alert.sender,
        sent: alert.sent,
        status: alert.status,
        event: info?.event || "-",
        urgency: info?.urgency || "-",
        severity: info?.severity || "-",
        certainty: info?.certainty || "-",
        effective: info?.effective,
        expires: info?.expires,
        senderName: info?.senderName || alert.sender,
        headline: info?.headline || "-",
        description: info?.description || "-",
        web: info?.web || null,
        areaDesc: Array.isArray(area.areaDesc) ? area.areaDesc[0] : area.areaDesc || "-",
        polygon: area.polygon || null,
        capUrl,
      };
    } catch (err) {
      console.error(`Gagal fetch CAP ${capUrl} (attempt ${attempt + 1}/${maxRetries}):`, err.message);
      if (attempt < maxRetries - 1) await sleep(2000);
    }
  }
  return null;
}

// Filter provinsi jika perlu
function filterByProvince(rssItems) {
  if (!PROVINCES_FILTER.length) return rssItems;
  return rssItems.filter((item) => {
    const prov = (item.title || "").match(/di\s+(.+)$/i)?.[1];
    return prov && PROVINCES_FILTER.some((p) => prov.toLowerCase().includes(p.toLowerCase()));
  });
}

// Ekstrak provinsi dari judul
export function extractProvince(title) {
  const match = (title || "").match(/di\s+(.+)$/i);
  return match ? match[1].trim() : "-";
}

// Ekstrak ID alert dari link CAP
export function extractAlertId(link) {
  const match = (link || "").match(/\/([^/]+)_alert\.xml$/i);
  return match ? match[1] : null;
}

// Orchestrator: fetch semua alert aktif + detail CAP-nya
export async function fetchAllActiveAlerts() {
  console.log("📡 Mengambil RSS feed peringatan dini...");
  const rssItems = await fetchRSS();

  if (!rssItems.length) {
    console.log("❌ Tidak ada peringatan aktif atau gagal fetch RSS.");
    return [];
  }

  const filtered = filterByProvince(rssItems);
  console.log(`✅ Ditemukan ${filtered.length} peringatan aktif.`);

  const cachedHistory = readHistory();
  const results = [];
  for (const item of filtered) {
    const alertId = extractAlertId(item.link);
    if (!alertId) {
      console.warn(`⚠️ Link CAP tidak valid: ${item.link}`);
      continue;
    }

    let capDetail = await fetchCAPDetail(item.link);
    if (!capDetail) {
      // Fallback: Jika fetch gagal setelah 3x retry, cari data cache di history agar alert aktif tidak ter-drop
      const cached = cachedHistory.find(
        (h) => h.capUrl === item.link || (extractProvince(item.title) === h.province && isAlertActive(h))
      );
      if (cached) {
        console.warn(`⚠️ Menggunakan data cache history untuk ${item.link} agar tidak drop dari state.`);
        capDetail = { ...cached };
      }
    }

    if (capDetail) {
      results.push({
        ...capDetail,
        province: extractProvince(item.title),
        rssTitle: item.title,
      });
    }
  }

  // Kalau feed mengandung beberapa versi dari alert yang sama,
  // simpan hanya versi dengan sent time paling baru.
  const latestByKey = new Map();

  for (const alert of results) {
    const key = getAlertKey(alert);
    const existing = latestByKey.get(key);

    if (!existing) {
      latestByKey.set(key, alert);
      continue;
    }

    const currentSent = Date.parse(alert.sent || "") || 0;
    const existingSent = Date.parse(existing.sent || "") || 0;

    if (currentSent >= existingSent) {
      latestByKey.set(key, alert);
    }
  }

  const latest = [...latestByKey.values()].sort((a, b) => {
    const aTime = Date.parse(a.sent || "") || 0;
    const bTime = Date.parse(b.sent || "") || 0;
    return bTime - aTime || String(a.headline).localeCompare(String(b.headline));
  });

  console.log(`✅ Berhasil parse ${results.length} CAP detail.`);
  console.log(`🧹 Setelah dedupe versi alert: ${latest.length} alert unik.`);
  return latest;
}
