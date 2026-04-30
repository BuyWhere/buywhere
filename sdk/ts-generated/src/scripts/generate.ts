import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const SPEC_PATH = path.resolve(__dirname, '../../../openapi.yaml');
const OUTPUT_DIR = path.resolve(__dirname, '..');

console.log('BuyWhere TypeScript Client Generator');
console.log('====================================');
console.log(`OpenAPI spec: ${SPEC_PATH}`);
console.log(`Output directory: ${OUTPUT_DIR}`);
console.log('');

if (!fs.existsSync(SPEC_PATH)) {
  console.error(`Error: OpenAPI spec not found at ${SPEC_PATH}`);
  process.exit(1);
}

console.log('Generating TypeScript client...');

try {
  execSync(
    `npx openapi-typescript-codegen \
      --input ${SPEC_PATH} \
      --output ${OUTPUT_DIR} \
      --client fetch \
      --name BuyWhere \
      --useUnionTypes \
      --exportCore true \
      --exportServices true \
      --exportModels true \
      --exportSchemas true`,
    {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    }
  );

  console.log('');
  console.log('Generation complete!');
  console.log(`Output written to: ${OUTPUT_DIR}`);
} catch (error) {
  console.error('Generation failed. Common issues:');
  console.error('1. Missing schema definitions in OpenAPI spec');
  console.error('2. Invalid JSON references');
  console.error('3. Run "npm run fix-spec" to attempt automatic fixes');
  process.exit(1);
}