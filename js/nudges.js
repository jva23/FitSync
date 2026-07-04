// Best-effort local nudges. There's no backend here — no push server, no
// periodic background sync — so these only fire while the app is actually
// open (typically right after launch), via the service worker's
// showNotification(). That's a real limitation of a no-build, no-server PWA;
// it's still useful as a "hey, look at this" the moment you open the app.
import { getSettings, getWorkoutPlanByWeek } from "./db.js";
import { mondayOf, weekISOFromMonday, todayLocalDate, addDaysStr } from "./utils.js";

const EXPORT_REMINDER_DAYS = 7;

export async function notify(title, body, tag) {
  if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: "./icons/icon-192.png" });
  } catch (e) {
    console.warn("Notification failed", e);
  }
}

export async function checkAndNotify() {
  const settings = await getSettings();
  if (!settings.notificationsEnabled || Notification.permission !== "granted") return;

  const today = todayLocalDate();

  if (!settings.lastExportAt || addDaysStr(settings.lastExportAt.slice(0, 10), EXPORT_REMINDER_DAYS) <= today) {
    await notify(
      "Back up your data",
      "It's been a while since your last export — worth a quick backup from Settings.",
      "export-reminder"
    );
  }

  const weekStart = mondayOf(today);
  const plan = await getWorkoutPlanByWeek(weekISOFromMonday(weekStart));
  if (plan) {
    const missed = plan.days.find((d) => !d.isRest && d.exercises.length > 0 && d.status !== "done" && d.date < today);
    if (missed) {
      await notify(
        "Missed workout",
        `${missed.focus || "A workout"} on ${missed.date} is still open — replan or mark it done on Today.`,
        "missed-workout"
      );
    }
  }
}
