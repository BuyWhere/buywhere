import type { AnswerBlock } from "@/lib/seo-landing-pages";

/**
 * BUY-74928 [OPENAI-CHANNEL]: 40-60-word plain-text answer block above the
 * fold on every intent page and on the live-offers /compare surface.
 *
 * Rendered server-side as a plain <p> with no client JS — this is the shape
 * ChatGPT retrieval lifts ("Amazon $X vs Walmart $Y, checked 25 Aug"). The
 * machine date is mirrored as a `data-answer-checked` attribute and inside a
 * <time> element so downstream crawlers and the BUY-74928 gate can parse it
 * deterministically.
 *
 * We render this FIRST in DOM order, before nav-heavy markup, the price
 * table, verdict sentence, FAQs and the rest — per the 4seen OAI-SearchBot
 * checklist (binding; full text in /home/paperclip/ops-canon/INTENT-PAGES-CHARTER.md).
 */
export function SeoAnswerBlock({ block, intent }: { block: AnswerBlock; intent: string }) {
  // Split the answer text into a verdict sentence and the "Prices checked …"
  // trailing clause so the answer block sits in DOM order before the price
  // table (4seen checklist item 1), then the verdict, then FAQs.
  const [verdict, ...rest] = block.text.split(". ");
  const trailing = rest.length > 0 ? `. ${rest.join(". ")}` : "";

  return (
    <section
      aria-label={`Quick answer for ${intent}`}
      data-answer-block="intent"
      data-answer-checked={block.checkedIso}
      data-answer-retailers={block.retailerCount}
      className="border-b border-amber-100 bg-amber-50/70 px-4 py-6 sm:px-6"
    >
      <div className="mx-auto max-w-6xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-800">
          Quick answer
        </p>
        <p className="answer-block-verdict mt-3 text-2xl font-semibold leading-9 text-slate-900 sm:text-3xl">
          {verdict}
          {trailing}
        </p>
        <p className="answer-block-checked mt-3 text-sm text-slate-700">
          Prices checked{" "}
          <time dateTime={block.checkedIso}>{block.checkedText}</time>
          {" "}across {block.retailerCount} retailer{block.retailerCount === 1 ? "" : "s"}.
        </p>
      </div>
    </section>
  );
}