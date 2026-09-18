/**
 * Decodes common HTML numeric entities (decimal and hex) to their Unicode characters.
 * Handles &#8243; (″ inch), &#8217; ('), &#8220; ("), &#169; (©), etc.
 */
export function decodeHtmlEntities(str: string): string {
  return str.replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
}
