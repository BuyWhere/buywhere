'use client';

import { useEffect, useRef, useState } from 'react';

interface CounterStat {
  value: number;
  suffix: string;
  label: string;
  icon: React.ReactNode;
}

interface SocialProofCounterProps {
  stats: CounterStat[];
}

function useCountUp(target: number, duration: number, started: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!started) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, started]);

  return count;
}

function StatItem({ stat, started }: { stat: CounterStat; started: boolean }) {
  const count = useCountUp(stat.value, 2000, started);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-indigo-400 mb-1">{stat.icon}</div>
      <span className="block text-4xl font-bold text-indigo-400 tabular-nums">
        {count.toLocaleString()}{stat.suffix}
      </span>
      <span className="text-sm text-gray-400">{stat.label}</span>
    </div>
  );
}

const SocialProofCounterComponent = function SocialProofCounterComponent(props: SocialProofCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="py-16 bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
          {props.stats.map((stat) => (
            <StatItem key={stat.label} stat={stat} started={started} />
          ))}
        </div>
      </div>
    </div>
  );
};

const defaultStats: CounterStat[] = [
  {
    value: 3800000,
    suffix: '+',
    label: 'Products Tracked',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    value: 5,
    suffix: '',
    label: 'Markets',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    value: 15,
    suffix: '+',
    label: 'Retailers',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9,22 9,12 15,12 15,22" />
      </svg>
    ),
  },
  {
    value: 1,
    suffix: 'M+',
    label: 'Price Updates Daily',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="23,6 13.5,15.5 8.5,10.5 1,18" />
        <polyline points="17,6 23,6 23,12" />
      </svg>
    ),
  },
];

export { SocialProofCounterComponent as SocialProofCounter, defaultStats };
export type { CounterStat };