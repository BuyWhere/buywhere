import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface FeatureCardProps {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}

export function FeatureCard({ title, description, href, icon }: FeatureCardProps) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-[#d4dde8] bg-white p-6 shadow-[0_12px_28px_rgba(10,14,26,0.05)] transition-all hover:-translate-y-0.5 hover:border-[#00d4c8]/40 hover:shadow-[0_18px_36px_rgba(10,14,26,0.08)]"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#dffaf7,#fff0cf)] text-[#0a9b94] transition-colors group-hover:bg-[linear-gradient(135deg,#c8f5f0,#ffe6b2)]">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-slate-900 transition-colors group-hover:text-[#0a9b94]">
            {title}
          </h3>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">
            {description}
          </p>
          <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#0a9b94] opacity-0 transition-opacity group-hover:opacity-100">
            Learn more
            <ArrowRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default FeatureCard;
