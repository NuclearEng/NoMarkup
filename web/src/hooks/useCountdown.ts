import { useState, useEffect } from 'react';

interface CountdownResult {
  timeLeft: string;
  isExpired: boolean;
  totalSeconds: number;
}

export function useCountdown(endTime: string | Date | null | undefined): CountdownResult {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!endTime) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  if (!endTime) {
    return { timeLeft: '--:--', isExpired: true, totalSeconds: 0 };
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
    timeLeft = `${days}d ${hours}h`;
  } else if (hours > 0) {
    timeLeft = `${hours}h ${minutes}m`;
  } else {
    timeLeft = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  return { timeLeft, isExpired: false, totalSeconds };
}
