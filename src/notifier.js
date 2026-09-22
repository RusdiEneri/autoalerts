import axios from "axios";
import { WEBHOOK_URL } from "./config.js";

const SEVERITY_COLOR = {
  Extreme: 0xff0000, // merah
  Severe: 0xff8c00, // oranye
  Moderate: 0xffd700, // kuning
  Minor: 0x00ff00, // hijau
};

const formatTime = (isoString) => {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium", timeStyle: "short",
    }).format(d);
  } catch {
    return isoString;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sendAlertToDiscord(alert) {
  if (!WEBHOOK_URL) return false;

  const payload = {
    embeds: [
      {
        title: `🚨 ${alert.headline}`,
        description: alert.description,
        color: SEVERITY_COLOR[alert.severity] || 0xffffff,
        fields: [
          { name: "📍 Wilayah", value: alert.areaDesc, inline: false },
          { name: "🌡️ Severity", value: alert.severity, inline: true },
          { name: "⚡ Urgency", value: alert.urgency, inline: true },
          { name: "🎯 Certainty", value: alert.certainty, inline: true },
          { name: "📅 Event", value: alert.event, inline: false },
          { name: "⏰ Berlaku", value: `${formatTime(alert.effective)} – ${formatTime(alert.expires)}`, inline: false },
          { name: "🏢 Sumber", value: alert.senderName || "BMKG", inline: true },
          ...(alert.web ? [{ name: "🌐 Infografik", value: `[Lihat Peta](${alert.web})`, inline: true }] : []),
        ],
        footer: {
          text: `ID: ${alert.identifier}`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await axios.post(WEBHOOK_URL, payload);
      console.log(`📨 Webhook terkirim: ${alert.headline}`);
      return true;
    } catch (err) {
      if (err.response?.status === 429 && attempt < maxRetries - 1) {
        const retryAfter = Number(err.response.headers["retry-after"]) || 2;
        console.warn(`⏳ Discord rate-limit. Menunggu ${retryAfter} detik...`);
        await sleep((retryAfter + 0.5) * 1000);
        continue;
      }
      console.error(`Gagal kirim webhook untuk ${alert.identifier}:`, err.message);
      return false;
    }
  }
  return false;
}