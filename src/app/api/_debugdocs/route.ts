import fs from "node:fs";
import path from "node:path";
export const dynamic = "force-dynamic";
function walk(d: string): string[] {
  try {
    return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const fp = path.join(d, e.name);
      return e.isDirectory() ? walk(fp) : [path.relative(d, fp)];
    });
  } catch (e) { return ["ERR:" + (e as Error).message]; }
}
export function GET() {
  const cwd = process.cwd();
  const docsDir = path.join(cwd, "docs");
  const out: Record<string, unknown> = { cwd };
  try { out.cwdEntries = fs.readdirSync(cwd); } catch (e) { out.cwdEntries = "ERR:" + (e as Error).message; }
  out.docsExists = fs.existsSync(docsDir);
  out.docsFiles = fs.existsSync(docsDir) ? walk(docsDir) : null;
  // sample one frontmatter
  try {
    const gs = path.join(docsDir, "getting-started.md");
    out.gettingStartedHead = fs.existsSync(gs) ? fs.readFileSync(gs, "utf8").slice(0, 120) : "MISSING";
  } catch (e) { out.gettingStartedHead = "ERR:" + (e as Error).message; }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
}
