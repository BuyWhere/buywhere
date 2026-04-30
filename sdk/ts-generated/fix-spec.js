#!/usr/bin/env node

/**
 * Fixes missing schema references in the OpenAPI spec.
 * Run this before generating the TypeScript client if you get
 * "Missing $ref pointer" errors.
 */

const fs = require('fs');
const yaml = require('js-yaml');

const SPEC_PATH = '/home/paperclip/buywhere-api/openapi.yaml';

console.log('Fixing missing OpenAPI schema references...');
console.log(`Spec path: ${SPEC_PATH}`);

let spec;
try {
  spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
} catch (e) {
  console.error('Failed to parse OpenAPI spec as YAML:', e.message);
  process.exit(1);
}

if (!spec.components) {
  spec.components = {};
}
if (!spec.components.schemas) {
  spec.components.schemas = {};
}

const RatingDistributionBucket = {
  type: 'object',
  required: ['stars', 'count'],
  properties: {
    stars: {
      type: 'integer',
      description: 'Star rating (1-5)',
      example: 5,
    },
    count: {
      type: 'integer',
      description: 'Number of reviews with this star rating',
      example: 750,
    },
    percentage: {
      type: 'number',
      description: 'Percentage of total reviews',
      example: 60.0,
    },
  },
};

const ReviewSource = {
  type: 'object',
  required: ['source', 'review_count', 'avg_rating'],
  properties: {
    source: {
      type: 'string',
      description: 'Source platform identifier',
      example: 'shopee_sg',
    },
    review_count: {
      type: 'integer',
      description: 'Number of reviews from this source',
      example: 500,
    },
    avg_rating: {
      type: 'number',
      description: 'Average rating from this source (0-5)',
      example: 4.5,
    },
    last_scraped: {
      type: 'string',
      format: 'date-time',
      description: 'When this review data was last scraped',
      example: '2026-04-04T10:30:00Z',
    },
  },
};

const ProductReviewsResponse = {
  type: 'object',
  required: ['product_id'],
  properties: {
    product_id: {
      type: 'integer',
      description: 'Product ID',
      example: 12345,
    },
    review_count: {
      type: 'integer',
      nullable: true,
      description: 'Total aggregated review count',
      example: 1250,
    },
    avg_rating: {
      type: 'number',
      nullable: true,
      description: 'Aggregated average rating (0-5)',
      example: 4.3,
    },
    rating_source: {
      type: 'string',
      nullable: true,
      description: 'Primary source of rating data',
      example: 'shopee_sg',
    },
    sentiment_score: {
      type: 'number',
      nullable: true,
      description: 'Sentiment score derived from review text (0-1 scale, higher = more positive)',
      example: 0.86,
    },
    rating_distribution: {
      type: 'array',
      items: { $ref: '#/components/schemas/RatingDistributionBucket' },
      description: 'Star rating distribution (1-5 stars)',
    },
    sources: {
      type: 'array',
      items: { $ref: '#/components/schemas/ReviewSource' },
      description: 'Per-source review breakdown',
    },
  },
};

const schemasToAdd = {
  RatingDistributionBucket,
  ReviewSource,
  ProductReviewsResponse,
};

let added = 0;
for (const [name, schema] of Object.entries(schemasToAdd)) {
  if (!spec.components.schemas[name]) {
    spec.components.schemas[name] = schema;
    console.log(`Added schema: ${name}`);
    added++;
  } else {
    console.log(`Schema already exists: ${name}`);
  }
}

if (added > 0) {
  fs.writeFileSync(SPEC_PATH, yaml.dump(spec, { indent: 2, lineWidth: -1 }));
  console.log(`\nFixed ${added} missing schema(s).`);
  console.log('Run "npm run generate" to regenerate the TypeScript client.');
} else {
  console.log('\nNo missing schemas found.');
}