import React from 'react';
import styles from './Spinner.module.css';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

export function Spinner({
  size = 'md',
  label = 'Loading',
  className = '',
}: SpinnerProps) {
  return (
    <span
      className={[styles.spinner, styles[size], className].filter(Boolean).join(' ')}
      role="status"
      aria-label={label}
    >
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  );
}

export default Spinner;