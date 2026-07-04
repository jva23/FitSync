// In-memory state + pub/sub. Views subscribe to events and re-render from here —
// nobody mutates the DOM off the back of a write directly.
const listeners = new Map();

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event)?.delete(cb);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((cb) => cb(payload));
  listeners.get("*")?.forEach((cb) => cb(event, payload));
}

export const state = {
  ready: false,
  route: "today",
  profile: null,
  settings: null,
  equipment: [],
  programs: [],
  exercises: [],
};
