const express = require('express');
const router = express.Router();
const { Product, SearchQuery } = require('../models');
const mongoose = require('mongoose');
const { logSearchError } = require('../utils/searchQueryLogger');

const QUERY_TIMEOUT_MS = 5000;
const CACHE_MAX_AGE = 'public, max-age=60, stale-while-revalidate=300';

const PRODUCT_PROJECTION = {
  sku: 1,
  source: 1,
  merchant_id: 1,
  title: 1,
  price: 1,
  currency: 1,
  price_sgd: 1,
  region: 1,
  country_code: 1,
  url: 1,
  brand: 1,
  category: 1,
  category_path: 1,
  image_url: 1,
  is_available: 1,
  in_stock: 1,
  stock_level: 1,
  data_updated_at: 1,
  rating: 1,
  review_count: 1,
  avg_rating: 1
};

function setCacheHeaders(res) {
  res.set('Cache-Control', CACHE_MAX_AGE);
}

async function searchProducts(req, res) {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || null;
  const ip = req.ip || req.headers['x-forwarded-for'] || null;
  const userAgent = req.headers['user-agent'] || null;
  const { q, country_code = 'US', limit = 20, offset = 0 } = req.query;

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Search query "q" is required' });
  }

  try {
    const country = country_code.toUpperCase();
    const filter = {
      is_active: true,
      country_code: country,
      $text: { $search: q }
    };

    const [products, total] = await Promise.all([
      Product.find(filter, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .skip(parseInt(offset))
        .limit(Math.min(parseInt(limit), 100))
        .maxTimeMS(QUERY_TIMEOUT_MS)
        .lean()
        .select(PRODUCT_PROJECTION),
      Product.countDocuments(filter).maxTimeMS(QUERY_TIMEOUT_MS)
    ]);

    setCacheHeaders(res);
    const limitInt = parseInt(limit);
    const offsetInt = parseInt(offset);

    SearchQuery.create({
      query: q.trim().toLowerCase(),
      country_code: country,
      search_date: new Date()
    }).catch(err => console.error('Failed to log search query:', err));

    return res.json({
      data: products,
      meta: {
        total,
        limit: limitInt,
        offset: offsetInt,
        next_offset: offsetInt + limitInt < total ? offsetInt + limitInt : null
      }
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logSearchError(null, {
      error,
      query: q,
      countryCode: country_code,
      durationMs,
      requestId,
      ip,
      userAgent
    });
    return res.status(500).json({ error: 'Search failed' });
  }
}

async function getProduct(req, res) {
  try {
    const { id } = req.params;
    const { country_code = 'US' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid product ID format' });
    }

    const product = await Product.findOne({
      _id: id,
      is_active: true,
      country_code: country_code.toUpperCase()
    })
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean()
      .select(PRODUCT_PROJECTION);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    setCacheHeaders(res);
    return res.json({ data: product });
  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({ error: 'Failed to get product' });
  }
}

async function getDeals(req, res) {
  try {
    const { country_code = 'US', limit = 20, offset = 0, min_price, max_price } = req.query;

    const country = country_code.toUpperCase();
    const filter = {
      is_active: true,
      country_code: country,
      is_available: true,
      in_stock: true
    };

    if (min_price !== undefined || max_price !== undefined) {
      filter.price = {};
      if (min_price !== undefined) filter.price.$gte = parseFloat(min_price);
      if (max_price !== undefined) filter.price.$lte = parseFloat(max_price);
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort({ data_updated_at: -1 })
        .skip(parseInt(offset))
        .limit(Math.min(parseInt(limit), 100))
        .maxTimeMS(QUERY_TIMEOUT_MS)
        .lean()
        .select(PRODUCT_PROJECTION),
      Product.countDocuments(filter).maxTimeMS(QUERY_TIMEOUT_MS)
    ]);

    setCacheHeaders(res);
    const limitInt = parseInt(limit);
    const offsetInt = parseInt(offset);
    return res.json({
      data: products,
      meta: {
        total,
        limit: limitInt,
        offset: offsetInt,
        next_offset: offsetInt + limitInt < total ? offsetInt + limitInt : null
      }
    });
  } catch (error) {
    console.error('Deals error:', error);
    return res.status(500).json({ error: 'Failed to get deals' });
  }
}

async function listProducts(req, res) {
  try {
    const { 
      category_id, 
      price_min, 
      price_max, 
      currency, 
      region,
      limit = 20, 
      offset = 0,
      sort_by = 'relevance',
      country_code = 'US'
    } = req.query;

    // Build filter
    const filter = {
      is_active: true,
      country_code: country_code.toUpperCase()
    };

    // Add category filter
    if (category_id) {
      filter.category = category_id;
    }

    // Add region filter
    if (region) {
      filter.region = region.toLowerCase();
    }

    // Add currency filter
    if (currency) {
      filter.currency = currency.toUpperCase();
    }

    // Add price range filter
    if (price_min !== undefined || price_max !== undefined) {
      filter.price = {};
      if (price_min !== undefined) filter.price.$gte = parseFloat(price_min);
      if (price_max !== undefined) filter.price.$lte = parseFloat(price_max);
    }

    // Build sort options
    let sortOptions = {};
    switch (sort_by) {
      case 'price_asc':
        sortOptions = { price: 1 };
        break;
      case 'price_desc':
        sortOptions = { price: -1 };
        break;
      case 'relevance':
      default:
        sortOptions = { data_updated_at: -1 }; // Most recently updated first
        break;
    }

    // Parse limit and offset
    const limitInt = Math.min(parseInt(limit), 100); // Max 100 results
    const offsetInt = parseInt(offset);

    // Get products and total count
    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortOptions)
        .skip(offsetInt)
        .limit(limitInt)
        .maxTimeMS(QUERY_TIMEOUT_MS)
        .lean()
        .select(PRODUCT_PROJECTION),
      Product.countDocuments(filter).maxTimeMS(QUERY_TIMEOUT_MS)
    ]);

    setCacheHeaders(res);
    return res.json({
      data: products,
      meta: {
        total,
        next_offset: offsetInt + limitInt < total ? offsetInt + limitInt : null
      }
    });
  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({ error: 'Failed to list products' });
  }
}

async function compareProduct(req, res) {
  try {
    const { _id, country_code = 'US' } = req.query;

    if (!_id) {
      return res.status(400).json({ error: '_id query param is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({ error: 'Invalid _id format' });
    }

    const country = country_code.toUpperCase();

    const product = await Product.findOne({
      _id,
      is_active: true,
      country_code: country
    })
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean()
      .select(PRODUCT_PROJECTION);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const similarProducts = await Product.find({
      _id: { $ne: product._id },
      is_active: true,
      country_code: country,
      category: product.category,
      price: {
        $gte: product.price * 0.8,
        $lte: product.price * 1.2
      }
    })
      .hint({ is_active: 1, country_code: 1, category: 1, price: 1 })
      .limit(5)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean()
      .select(PRODUCT_PROJECTION);

    setCacheHeaders(res);
    return res.json({
      data: {
        product,
        similar: similarProducts
      }
    });
  } catch (error) {
    console.error('Compare error:', error);
    return res.status(500).json({ error: 'Failed to compare products' });
  }
}

async function getTrending(req, res) {
  try {
    const { period = '7d', limit = 50, country_code = 'SG', category } = req.query;

    let hoursBack;
    if (period === '24h') {
      hoursBack = 24;
    } else if (period === '7d') {
      hoursBack = 168;
    } else {
      return res.status(400).json({ error: 'Invalid period. Use 24h or 7d' });
    }

    const dateCutoff = new Date();
    dateCutoff.setHours(dateCutoff.getHours() - hoursBack);

    const matchStage = {
      search_timestamp: { $gte: dateCutoff },
      country_code: country_code.toUpperCase()
    };

    if (category) {
      matchStage.category = category;
    }

    const topQueries = await SearchQuery.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { query: '$query', category: '$category' },
          search_count: { $sum: 1 }
        }
      },
      { $sort: { search_count: -1 } },
      { $limit: Math.min(parseInt(limit), 100) }
    ]);

    const queries = topQueries.map(q => q._id.query);

    const products = await Product.find({
      is_active: true,
      country_code: country_code.toUpperCase(),
      $text: { $search: queries.join(' ') }
    })
      .limit(100)
      .maxTimeMS(QUERY_TIMEOUT_MS)
      .lean()
      .select(PRODUCT_PROJECTION);

    setCacheHeaders(res);
    return res.json({
      data: products,
      meta: {
        period,
        period_hours: hoursBack,
        country_code: country_code.toUpperCase(),
        top_searches: topQueries.map(q => ({
          query: q._id.query,
          category: q._id.category,
          search_count: q.search_count
        })),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Trending error:', error);
    return res.status(500).json({ error: 'Failed to get trending products' });
  }
}

async function autocomplete(req, res) {
  const startTime = Date.now();
  const { q, limit = 5, country_code = 'SG' } = req.query;

  if (!q || q.trim().length === 0) {
    return res.json({ suggestions: [] });
  }

  const limitInt = Math.min(parseInt(limit), 20);
  const country = country_code.toUpperCase();
  const queryStr = q.trim();

  const cacheKey = `autocomplete:${country}:${queryStr}:${limitInt}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.set('X-Cache', 'HIT');
    return res.json({ suggestions: cached });
  }

  try {
    let suggestions = [];

    if (process.env.TYPESENSE_URL) {
      try {
        const tsRes = await fetch(
          `${process.env.TYPESENSE_URL}/collections/products/documents/search?q=${encodeURIComponent(queryStr)}&query_by=title&prefix_algo=prefix_search&limit=${limitInt}&filter_by=country_code:${country}&query_by_weights=title:3,category:1`,
          {
            headers: {
              'X-TYPESENSE-API-KEY': process.env.TYPESENSE_API_KEY || ''
            },
            signal: AbortSignal.timeout(1000)
          }
        );
        if (tsRes.ok) {
          const tsData = await tsRes.json();
          suggestions = (tsData.hits || []).map(h => h.document.title);
        }
      } catch (tsErr) {
        console.warn('Typesense autocomplete failed, falling back to DB:', tsErr.message);
      }
    }

    if (suggestions.length === 0) {
      const words = queryStr.split(/\s+/);
      const orConditions = words.map(w => ({
        title: { $regex: `^${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' }
      }));

      const products = await Product.find({
        is_active: true,
        country_code: country,
        $or: orConditions.length === 1 ? orConditions : [
          { $or: orConditions },
          { title: { $regex: `^${queryStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' } }
        ]
      })
        .sort({ data_updated_at: -1 })
        .limit(limitInt)
        .select({ title: 1, _id: 0 })
        .lean();

      suggestions = products.map(p => p.title);
    }

    cache.set(cacheKey, suggestions, 30000);
    return res.json({ suggestions });
  } catch (error) {
    console.error('Autocomplete error:', error);
    return res.status(500).json({ error: 'Autocomplete failed' });
  }
}

const cache = new Map();
setInterval(() => cache.clear(), 60000);

router.get('/search', searchProducts);
router.get('/autocomplete', autocomplete);
router.get('/deals', getDeals);
router.get('/trending', getTrending);
router.get('/compare', compareProduct);
router.get('/', listProducts); // New paginated product listing endpoint
router.get('/:id', getProduct);

module.exports = router;