import dotenv from "dotenv";
dotenv.config();

// Kosongkan jika tidak ingin notifikasi Discord (README tetap update)
export const WEBHOOK_URL = process.env.WEBHOOK_URL || "";

// RSS Feed BMKG untuk peringatan dini cuaca nasional
export const RSS_URL = "https://www.bmkg.go.id/alerts/nowcast/id/rss.xml";

// Filter provinsi yang ingin dipantau (kosongkan untuk semua provinsi)
export const PROVINCES_FILTER = [
  // "Jawa Timur",
  // "Jawa Tengah",
  // "DKI Jakarta",
];