// Small shared helpers. Dates are always local YYYY-MM-DD strings — never
// UTC-midnight Date objects — to avoid the off-by-one-day bug on evening logging.
export function lbToKg(lb) {
  return lb * 0.45359237;
}

export function kgToLb(kg) {
  return kg / 0.45359237;
}

export function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function uid() {
  return crypto.randomUUID();
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function ozToMl(oz) {
  return oz * 29.5735;
}

export function mlToOz(ml) {
  return ml / 29.5735;
}

function parseLocalDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

export function addDaysStr(dateStr, n) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
}

export function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Monday of the week containing dateStr.
export function mondayOf(dateStr) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDateStr(d);
}

// ISO week label like "2026-W28". Good enough for a single-user app —
// doesn't handle the rare year-boundary edge case with full ISO rigor.
export function weekISOFromMonday(mondayStr) {
  const d = parseLocalDate(mondayStr);
  const target = new Date(d.valueOf());
  target.setDate(target.getDate() + 3); // Thursday of this week
  const firstJan = new Date(target.getFullYear(), 0, 1);
  const weekNumber = Math.ceil(((target - firstJan) / 86400000 + 1) / 7);
  return `${target.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export function weekDays(mondayStr) {
  return Array.from({ length: 7 }, (_, i) => addDaysStr(mondayStr, i));
}

export function formatWeekLabel(mondayStr) {
  const end = addDaysStr(mondayStr, 6);
  const opts = { month: "short", day: "numeric" };
  const s = parseLocalDate(mondayStr).toLocaleDateString("en-US", opts);
  const e = parseLocalDate(end).toLocaleDateString("en-US", opts);
  return `${s} – ${e}`;
}

export function formatDayLabel(dateStr) {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function isToday(dateStr) {
  return dateStr === todayLocalDate();
}

// Recipe scaling: rounds a scaled ingredient amount to 2 decimal places and
// strips trailing zeros, so scaling 4 -> 6 servings prints "1.5" instead of
// "1.500000001". No fraction-glyph conversion — plain decimals are legible
// enough and avoid inventing a fraction-formatting system.
export function formatAmount(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

export function scaleAmount(amount, baseServings, targetServings) {
  if (!amount || !baseServings) return amount;
  return (amount * targetServings) / baseServings;
}

// Downscales a photo client-side before it ever touches IndexedDB or an AI
// vision call, so attaching a few phone photos doesn't blow through storage
// quota or the API's per-image size limits.
export function downscaleImage(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Suggests a barbell plate-loading breakdown per side. A helper, not an
// enforcement — the lifter can always load whatever they actually have.
export function plateMath(targetWeight, barWeight = 45, availablePlates = [45, 35, 25, 10, 5, 2.5]) {
  const perSide = (targetWeight - barWeight) / 2;
  if (!(perSide > 0)) return { perSide: 0, plates: [], remainder: 0 };
  const plates = [];
  let remaining = perSide;
  for (const p of availablePlates) {
    while (remaining >= p - 0.001) {
      plates.push(p);
      remaining -= p;
    }
  }
  return { perSide, plates, remainder: Math.round(remaining * 100) / 100 };
}
