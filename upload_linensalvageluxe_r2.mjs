import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { load } from 'dotenv';
import crypto from 'crypto';

load();

const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const bucket = process.env.CLOUDFLARE_R2_BUCKET || 'buywhere-data';
const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
const TODAY = new Date().toISOString().slice(0, 10);

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

const file = `/paperclip/instances/default/workspaces/7fb55262-e658-45e2-88c0-b0e8ccc5ad6c/data/shopify_linensalvageluxe_com_${TODAY}.jsonl`;
const key = `shopify/linensalvageluxe.com/${TODAY}.jsonl`;
const body = readFileSync(file);

try {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/x-ndjson',
  }));
  console.log(`Uploaded ${key} (${body.length} bytes) to ${bucket}`);
} catch (e) {
  console.error('Upload error:', e.message, e.$metadata);
  process.exit(1);
}
