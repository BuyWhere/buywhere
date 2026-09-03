import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let target = path.join(root, "src", specifier.slice(2));
    if (!path.extname(target)) target = `${target}.ts`;
    return nextResolve(pathToFileURL(target).href, context);
  }
  return nextResolve(specifier, context);
}
