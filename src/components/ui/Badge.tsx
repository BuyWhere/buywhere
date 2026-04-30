import React from 'react';
import styles from './Badge.module.css';

export interface BadgeProps {
  variant?: 'new' | 'sale' | 'out-of-stock';
  children: React.ReactNode;
  className?: string;
}

export function Badge({
  variant = 'new',
  children,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={[styles.badge, styles[variant], className].filter(Boolean).join(' ')}
      role="status"
    >
      {children}
    </span>
  );
}

export default Badge;