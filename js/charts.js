// Thin Chart.js wrapper so every chart in Progress shares the same muted,
// phone-readable styling instead of repeating options objects everywhere.
import { Chart } from "https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm";

const AXIS_COLOR = "#a89e91";
const GRID_COLOR = "#3a332b";

const BASE_OPTIONS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: AXIS_COLOR } },
  },
  scales: {
    x: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } },
    y: { ticks: { color: AXIS_COLOR }, grid: { color: GRID_COLOR } },
  },
};

export function makeChart(canvas, config) {
  return new Chart(canvas, {
    ...config,
    options: { ...BASE_OPTIONS, ...(config.options || {}) },
  });
}

export const EMBER = "#ff5d2e";
export const EMBER_DIM = "rgba(255, 93, 46, 0.25)";
