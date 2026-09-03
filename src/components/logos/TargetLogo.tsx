export function TargetLogo({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 300 300" fill="currentColor" aria-label="Target">
      <circle cx="150" cy="150" r="145" fill="none" stroke="currentColor" strokeWidth="10"/>
      <circle cx="150" cy="150" r="50" fill="currentColor"/>
      <circle cx="150" cy="150" r="95" fill="none" stroke="currentColor" strokeWidth="10"/>
    </svg>
  );
}
