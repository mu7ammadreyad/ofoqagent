// helpers.js — OFOQ Agent v5.0
// Utility functions — see md/helpers.md for full documentation

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ================================================================
// calcFajr — Astronomical fajr calculation (18°)
// ================================================================
export function calcFajr(lat, lng, date = new Date()) {
  const D2R = Math.PI / 180;
  const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate();
  const JD = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (mo + 1)) + d - 1524.5;
  const n  = JD - 2451545.0;
  const L  = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g  = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = 23.439 * D2R;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const RA  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const EqT = (L * D2R - RA) * 12 / Math.PI;
  // UTC+2 (Egypt — no DST since 2011)
  const noon = 12 - lng / 15 - EqT + 2;
  const fAng = 18 * D2R;
  const cosH = (Math.sin(-fAng) - Math.sin(lat * D2R) * Math.sin(dec)) / (Math.cos(lat * D2R) * Math.cos(dec));
  if (Math.abs(cosH) > 1) return null;
  const fTime = (((noon - Math.acos(cosH) * 12 / Math.PI) % 24) + 24) % 24;
  const hh = Math.floor(fTime), mm = Math.floor((fTime - hh) * 60);
  return { hours: hh, minutes: mm, formatted: `${pad(hh)}:${pad(mm)}` };
}

// ================================================================
// makeDefaultSlots — smart time slot distribution
// ================================================================
export function makeDefaultSlots(startH, startM, count) {
  let s = startH * 60 + startM;
  const e = 23 * 60;
  if (s >= e) s = 6 * 60 + 30;
  const base = Math.floor((e - s) / Math.max(count, 1));
  const out  = [];
  for (let i = 0; i < count; i++) {
    const jitter = Math.floor(Math.random() * 18) - 9;
    const t = Math.min(e - 1, Math.max(s, s + i * base + jitter));
    out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  return out.sort();
}

// ================================================================
// buildSlotTimestamp — Cairo UTC+2 timestamp
// ================================================================
export function buildSlotTimestamp(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00+02:00`).getTime();
}

// ================================================================
// pad — zero-pad number for time strings
// ================================================================
export function pad(n) {
  return String(n).padStart(2, '0');
}

// ================================================================
// sleep — async wait
// ================================================================
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ================================================================
// readMarkdownFile — read from md/ directory
// ================================================================
export function readMarkdownFile(filename) {
  try {
    return readFileSync(join(__dirname, '..', 'md', filename), 'utf8');
  } catch {
    console.error(`[helpers] Could not read md/${filename}`);
    return '';
  }
}

// ================================================================
// cairoToday — current date in Cairo timezone
// ================================================================
export function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// ================================================================
// formatCairoTime — readable Cairo datetime
// ================================================================
export function formatCairoTime(date = new Date()) {
  return date.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
}

// ================================================================
// stripThoughts — CRITICAL FIX for thought_signature error
// Gemini 2.5 Flash adds thought:true parts to responses.
// Sending them back in history causes:
//   "thought_signature missing in functionCall parts"
// Solution: strip all thought parts before sending history back.
// ================================================================
export function stripThoughts(messages) {
  return messages
    .map(m => ({
      ...m,
      parts: (m.parts || []).filter(p => p.thought !== true),
    }))
    .filter(m => m.parts && m.parts.length > 0);
}

// ================================================================
// chunkify — split long text for Firestore
// Firestore document limit: 1 MB
// ================================================================
export function chunkify(text, size = 800) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

// ================================================================
// sanitizeForLog — remove sensitive data before logging
// ================================================================
export function sanitizeForLog(obj) {
  const SENSITIVE = ['token', 'client_secret', 'refresh_token', 'access_token', 'password', 'apiKey', 'api_key'];
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.some(s => k.toLowerCase().includes(s))) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = sanitizeForLog(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ================================================================
// log — structured console logging
// ================================================================
export function log(level, section, message, data = null) {
  const ts    = formatCairoTime();
  const emoji = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌' }[level] || '•';
  console.log(`${emoji} [${ts}] [${section}] ${message}`);
  if (data) console.log(JSON.stringify(sanitizeForLog(data), null, 2));
}
