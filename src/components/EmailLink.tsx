"use client";

export function EmailLink({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  return (
    <a href={`mailto:${email}`} className={className}>
      {email}
    </a>
  );
}
