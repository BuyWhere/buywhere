"use client";

import { useEffect, useState } from "react";

interface MailtoLinkProps {
  email: string;
  className?: string;
}

/**
 * Renders a mailto: link only on the client to prevent Cloudflare email obfuscation.
 * SSR fallback shows the email as plain text so crawlers still see the address.
 */
export default function MailtoLink({ email, className }: MailtoLinkProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <span className={className}>{email}</span>;
  }

  return (
    <a href={`mailto:${email}`} className={className}>
      {email}
    </a>
  );
}
