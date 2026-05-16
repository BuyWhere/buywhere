#!/usr/bin/env node
// Simple database test using only pg
const { Pool } = require('pg');

// Database configuration
const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/buywhere',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function testDatabaseConnection() {
  console.log('Testing database connection...');
  
  try {
    // Test basic connection
    const result = await db.query('SELECT NOW() as current_time');
    console.log('✅ Database connection successful');
    console.log('Current time:', result.rows[0].current_time);
    
    // Test basic products table query
    const productCount = await db.query('SELECT COUNT(*) as count FROM products LIMIT 1');
    console.log('✅ Products table accessible, row count:', productCount.rows[0].count);
    
    // Test MCP-specific queries
    console.log('\n--- Testing MCP tool queries ---');
    
    // Test search_products query (simplified)
    try {
      const searchResult = await db.query(`
        SELECT id, title, price 
        FROM products 
        WHERE search_vector @@ plainto_tsquery('english', 'test') 
        LIMIT 5
      `);
      console.log('✅ Search query successful, found:', searchResult.rows.length, 'results');
    } catch (searchErr) {
      console.log('❌ Search query failed:', searchErr.message);
    }
    
    // Test get_deals query (simplified)
    try {
      const dealsResult = await db.query(`
        SELECT id, title, price, 
               COALESCE(discount_pct, 0) as discount_pct
        FROM products 
        WHERE currency = 'SGD' 
        AND price > 0 
        LIMIT 5
      `);
      console.log('✅ Deals query successful, found:', dealsResult.rows.length, 'results');
    } catch (dealsErr) {
      console.log('❌ Deals query failed:', dealsErr.message);
    }
    
    // Test compare_products query
    try {
      if (productCount.rows[0].count > 0) {
        const compareResult = await db.query(`
          SELECT id, title, price, brand
          FROM products 
          WHERE id IN (SELECT id FROM products LIMIT 2)
        `);
        console.log('✅ Compare query successful, found:', compareResult.rows.length, 'products');
      }
    } catch (compareErr) {
      console.log('❌ Compare query failed:', compareErr.message);
    }
    
    // Test list_categories query
    try {
      const categoriesResult = await db.query(`
        SELECT category_path[1] AS slug, COUNT(*) AS product_count
        FROM products 
        WHERE category_path IS NOT NULL 
        AND array_length(category_path, 1) > 0
        GROUP BY 1
        ORDER BY product_count DESC
        LIMIT 5
      `);
      console.log('✅ Categories query successful, found:', categoriesResult.rows.length, 'categories');
    } catch (categoriesErr) {
      console.log('❌ Categories query failed:', categoriesErr.message);
    }
    
    // Test find_best_price query
    try {
      const bestPriceResult = await db.query(`
        SELECT id, title, price, source AS domain
        FROM products 
        WHERE search_vector @@ plainto_tsquery('english', 'phone')
        AND is_active = true
        ORDER BY price ASC
        LIMIT 3
      `);
      console.log('✅ Best price query successful, found:', bestPriceResult.rows.length, 'results');
    } catch (bestPriceErr) {
      console.log('❌ Best price query failed:', bestPriceErr.message);
    }
    
    // Test discount column specifically
    console.log('\n--- Testing discount column ---');
    try {
      const discountCheck = await db.query(`
        SELECT 
          column_name, 
          data_type 
        FROM information_schema.columns 
        WHERE table_name = 'products' 
        AND column_name = 'discount_pct'
      `);
      console.log('✅ Discount column check:', discountCheck.rows.length > 0 ? 'exists' : 'does not exist');
    } catch (discountErr) {
      console.log('❌ Discount column check failed:', discountErr.message);
    }
    
    // Test metadata for original_price fallback
    try {
      const metadataCheck = await db.query(`
        SELECT id, title, price, metadata
        FROM products 
        WHERE metadata->>'original_price' IS NOT NULL
        LIMIT 3
      `);
      console.log('✅ Metadata with original_price found:', metadataCheck.rows.length, 'products');
      if (metadataCheck.rows.length > 0) {
        console.log('Sample metadata:', metadataCheck.rows[0].metadata);
      }
    } catch (metadataErr) {
      console.log('❌ Metadata check failed:', metadataErr.message);
    }
    
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
    console.log('Error details:', error);
  } finally {
    await db.end();
  }
}

testDatabaseConnection().catch(console.error);