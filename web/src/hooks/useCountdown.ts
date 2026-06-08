import { useState, useEffect } from 'react';

interface CountdownResult {
  timeLeft: string;
  isExpired: boolean;
  totalSeconds: number;
}

export function useCountdown(endTime: string | Date | null | undefined): CountdownResult {
  // `now` starts null so the SSR render and the first client render are
  // deterministic (no Date.now() in initial render). It's filled in after mount;
  // otherwise the countdown computed on the server differs from the client a
  // moment later → React hydration mismatch.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!endTime) return;
    setNow(Date.now()); // first live value, post-mount
    const interval = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(interval); };
  }, [endTime]);

  if (!endTime) {
    return { timeLeft: '--:--', isExpired: true, totalSeconds: 0 };
  }

  // Pre-mount placeholder — identical on server and first client render.
  if (now === null) {
    return { timeLeft: '--:--', isExpired: false, totalSeconds: 0 };
  }

  const end = new Date(endTime).getTime();
  const diff = Math.max(0, end - now);
  const totalSeconds = Math.floor(diff / 1000);

  if (totalSeconds <= 0) {
    return { timeLeft: '0:00', isExpired: true, totalSeconds: 0 };
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let timeLeft: string;
  if (days > 0) {
    timeLeft = `${String(days)}d ${String(hours)}h`;
  } else if (hours > 0) {
    timeLeft = `${String(hours)}h ${String(minutes)}m`;
  } else {
    timeLeft = `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
  }

  return { timeLeft, isExpired: false, totalSeconds };
}
