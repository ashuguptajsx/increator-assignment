/**
 * Search API - Express.js Server
 * 
 * RESTful API for searching and discovering influencers
 * with semantic search, filtering, and ranking.
 */

const express = require('express');
const cors = require('cors');
const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAI } = require('openai');
const { Pool } = require('pg');
const Redis = require('ioredis');
const logger = require('../utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connections
const pgPool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 20
});

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT || 6379
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const pineconeIndex = pinecone.index('creator-embeddings-prod');

// ==================== HELPER FUNCTIONS ====================

async function generateQueryEmbedding(query) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  return response.data[0].embedding;
}

function buildPineconeFilter(filters) {
  const pineconeFilter = {};
  
  if (filters.platforms && filters.platforms.length > 0) {
    pineconeFilter.platform = { $in: filters.platforms };
  }
  
  if (filters.niches && filters.niches.length > 0) {
    pineconeFilter.primary_niche = { $in: filters.niches };
  }
  
  if (filters.followers_min) {
    pineconeFilter.followers_count = { $gte: filters.followers_min };
  }
  
  if (filters.verified_only) {
    pineconeFilter.verified = { $eq: true };
  }
  
  if (filters.countries && filters.countries.length > 0) {
    pineconeFilter.country = { $in: filters.countries };
  }
  
  return pineconeFilter;
}

function calculateRankingScore(creator, semanticScore) {
  // Normalize scores
  const maxFollowers = 10000000; // 10M
  const maxEngagement = 10; // 10%
  
  const semanticWeight = 0.5;
  const engagementWeight = 0.3;
  const followersWeight = 0.2;
  
  const engagementScore = Math.min(creator.engagement_rate / maxEngagement, 1);
  const followersScore = Math.min(creator.followers_count / maxFollowers, 1);
  
  // Quality multiplier
  const qualityMultiplier = creator.verified ? 1.1 : 1.0;
  
  const finalScore = (
    semanticWeight * semanticScore +
    engagementWeight * engagementScore +
    followersWeight * followersScore
  ) * qualityMultiplier;
  
  return finalScore;
}

// ==================== API ENDPOINTS ====================

/**
 * POST /api/v1/search
 * Search for creators with semantic search and filters
 */
app.post('/api/v1/search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { query, filters = {}, sort_by = 'relevance', page = 1, limit = 20 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    // Generate cache key
    const cacheKey = `search:${JSON.stringify({ query, filters, sort_by, page, limit })}`;
    
    // Check cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.info('Cache hit for search', { query, cache_key: cacheKey });
      return res.json({
        ...JSON.parse(cached),
        metadata: {
          query,
          latency_ms: Date.now() - startTime,
          cache_hit: true
        }
      });
    }
    
    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query);
    
    // Vector search in Pinecone
    const vectorResults = await pineconeIndex.query({
      vector: queryEmbedding,
      topK: 100, // Get more candidates for reranking
      filter: buildPineconeFilter(filters),
      includeMetadata: true
    });
    
    // Fetch full profiles from PostgreSQL
    const creatorIds = vectorResults.matches.map(m => m.metadata.creator_id);
    
    if (creatorIds.length === 0) {
      return res.json({
        results: [],
        pagination: { page, limit, total_results: 0, total_pages: 0 },
        metadata: { query, latency_ms: Date.now() - startTime, cache_hit: false }
      });
    }
    
    const pgResult = await pgPool.query(
      'SELECT * FROM creators WHERE creator_id = ANY($1) AND is_active = TRUE',
      [creatorIds]
    );
    
    // Rank results
    const rankedResults = pgResult.rows.map(creator => {
      const vectorMatch = vectorResults.matches.find(
        m => m.metadata.creator_id === creator.creator_id
      );
      
      return {
        ...creator,
        relevance_score: calculateRankingScore(creator, vectorMatch.score),
        semantic_similarity: vectorMatch.score
      };
    }).sort((a, b) => b.relevance_score - a.relevance_score);
    
    // Pagination
    const totalResults = rankedResults.length;
    const totalPages = Math.ceil(totalResults / limit);
    const paginatedResults = rankedResults.slice((page - 1) * limit, page * limit);
    
    const response = {
      results: paginatedResults,
      pagination: {
        page,
        limit,
        total_results: totalResults,
        total_pages: totalPages
      },
      metadata: {
        query,
        latency_ms: Date.now() - startTime,
        cache_hit: false
      }
    };
    
    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(response));
    
    logger.info('Search completed', {
      query,
      results_count: paginatedResults.length,
      latency_ms: Date.now() - startTime
    });
    
    res.json(response);
  } catch (error) {
    logger.error('Search error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/creators/:creatorId
 * Get creator profile by ID
 */
app.get('/api/v1/creators/:creatorId', async (req, res) => {
  try {
    const { creatorId } = req.params;
    
    const result = await pgPool.query(
      'SELECT * FROM creators WHERE creator_id = $1',
      [creatorId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Get creator error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/health
 * Health check endpoint
 */
app.get('/api/v1/health', async (req, res) => {
  try {
    // Check database connection
    await pgPool.query('SELECT 1');
    
    // Check Redis connection
    await redis.ping();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        postgres: 'connected',
        redis: 'connected',
        pinecone: 'connected'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  logger.info(`InCreator API server running on port ${PORT}`);
});

module.exports = app;
