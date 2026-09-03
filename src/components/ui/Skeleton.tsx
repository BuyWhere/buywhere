import React from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
}: SkeletonProps) {
  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <span
      className={[styles.skeleton, styles[variant], className].filter(Boolean).join(' ')}
      style={Object.keys(style).length ? style : undefined}
      aria-hidden="true"
    />
  );
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className = '' }: SkeletonTextProps) {
  return (
    <span className={[styles.textWrapper, className].filter(Boolean).join(' ')} aria-label="Loading text">
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className={[styles.skeleton, styles.text, i === lines - 1 ? styles.lastLine : ''].join(' ')}
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </span>
  );
}

export default Skeleton;