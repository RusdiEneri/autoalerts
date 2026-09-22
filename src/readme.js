import fs from "fs";
import path from "path";

const README_PATH = path.resolve("README.md");

const SEVERITY_ICON = {
  Extreme: "🔴",
  Severe: "🟠",
  Moderate: "🟡",
  Minor: "🟢",
};

const URGENCY_ICON = {
  Immediate: "⚡",
  Expected: "⏰",
  Future: "🕐",
  Past: "✅",
};

const severityIcon = (sev) => SEVERITY_ICON[sev] || "⚪";
const urgencyIcon = (urg) => URGENCY_ICON[urg] || "❓";

const formatTime = (isoString) => {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
};

const truncateDesc = (desc, maxLen = 200) => {
  const clean = String(desc || "").replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
};

export function buildReadme(activeAlerts, history, nowWib) {
  const activeRows = activeAlerts.length
    ? activeAlerts
        .map((a) => {
          const sevIcon = severityIcon(a.severity);
          const urgIcon = urgencyIcon(a.urgency);
          const duration = a.effective && a.expires
            ? `${formatTime(a.effective)} – ${formatTime(a.expires)}`
            : "-";
          const webLink = a.web ? ` | [Infografik](${a.web})` : "";

          return `| ${sevIcon} ${a.severity} | ${urgIcon} ${a.urgency} | **${a.headline}**<br>📍 ${a.areaDesc}<br>${truncateDesc(a.description, 150)}${webLink} | ${duration} |`;
        })
        .join("\n")
    : "| – | – | ✅ **Tidak ada peringatan dini cuaca aktif saat ini** | – |";

  const historyRows = history.length
    ? history
        .map((a) => {
          const sevIcon = severityIcon(a.severity);
          return `| ${sevIcon} ${a.severity} | ${a.headline} | ${a.province} | ${formatTime(a.effective)} – ${formatTime(a.expires)} | ${formatTime(a.detectedAt)} |`;
        })
        .join("\n")
    : "| – | – | – | – | – |";

  return `# 🚨 AutoAlerts — Peringatan Dini Cuaca BMKG

> Monitor real-time peringatan dini cuaca ekstrem dari **BMKG** (nowcast, 0–6 jam ke depan). Data diambil otomatis setiap 10 menit dari API publik BMKG, ditampilkan langsung di README ini, dan dikirim ke Discord webhook jika ada peringatan baru.

🕒 **Update terakhir:** ${nowWib}
📊 **Peringatan aktif saat ini:** ${activeAlerts.length}
📜 **Riwayat peringatan terakhir:** ${history.length}

---

## ⚡ Peringatan Dini Aktif

| Severity | Urgency | Headline & Wilayah | Durasi (WIB) |
| --- | --- | --- | --- |
${activeRows}

---

## 📜 Riwayat ${history.length} Peringatan Terakhir

| Severity | Headline | Provinsi | Periode Berlaku | Terdeteksi |
| --- | --- | --- | --- | --- |
${historyRows}

---

## 🛠️ Cara Kerja Repository Ini

- Workflow \`.github/workflows/alerts.yml\` berjalan otomatis setiap **10 menit**.
- \`src/index.js\` mengambil RSS feed dari \`https://www.bmkg.go.id/alerts/nowcast/id/rss.xml\`.
- Untuk tiap alert baru (berdasarkan \`identifier\`):
  - Detail CAP XML diambil dari server BMKG,
  - \`README.md\` di-generate ulang dengan peringatan aktif + riwayat,
  - notifikasi **Discord webhook** dikirim (jika dikonfigurasi),
  - state disimpan di \`data/alerts-state.json\` agar tidak spam.

### 📊 Arti Severity & Urgency (CAP Protocol)

| Severity | Arti |
| --- | --- |
| 🔴 Extreme | Bencana yang sangat parah (ancaman nyawa) |
| 🟠 Severe | Dampak signifikan, potensi bahaya serius |
| 🟡 Moderate | Dampak sedang, perlu kewaspadaan |
| 🟢 Minor | Dampak kecil, informasional |

| Urgency | Arti |
| --- | --- |
| ⚡ Immediate | Harus bertindak **sekarang** |
| ⏰ Expected | Tindakan segera diperlukan |
| 🕐 Future | Bersiap untuk kemungkinan di masa depan |

---

<div align="center">

Dibuat dengan ❤️ oleh [RusdiEneri](https://github.com/RusdiEneri) • Sumber data: [BMKG — Nowcasting](https://nowcasting.bmkg.go.id/)

_README ini dibuat otomatis oleh GitHub Actions — jangan edit manual._

</div>
`;
}

export function updateReadme(activeAlerts, history) {
  const nowWib = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "full",
    timeStyle: "medium",
  }).format(new Date());

  fs.writeFileSync(README_PATH, buildReadme(activeAlerts, history, nowWib), "utf8");
}