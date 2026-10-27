// Keeps the screen on while music plays or scrolls (where the browser allows it).

let lock: WakeLockSentinel | null = null;
let wanted = false;

async function acquire() {
  try {
    if (wanted && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    }
  } catch {
    // not allowed (e.g. battery saving): the screen may turn off
  }
}

document.addEventListener('visibilitychange', () => void acquire());

export function keepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else {
    void lock?.release();
    lock = null;
  }
}
