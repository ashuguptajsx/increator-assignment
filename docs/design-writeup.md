# InCreator AI - System Design Document
## Scalable Influencer Discovery Platform for 250M+ Creators

**Version**: 1.0  
**Date**: November 27, 2025  
**Author**: Founding Engineer Candidate

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Data Model & Partitioning](#data-model--partitioning)
3. [Ingestion Architecture](#ingestion-architecture)
4. [Identity Resolution](#identity-resolution)
5. [Retrieval & Ranking](#retrieval--ranking)
6. [AI Integration](#ai-integration)
7. [Monitoring & Observability](#monitoring--observability)
8. [Security & Multi-Tenancy](#security--multi-tenancy)
9. [Cost Analysis](#cost-analysis)

---

## 1. Executive Summary

This document outlines the architecture for a **multi-platform influencer discovery system** designed to scale from 1M to 250M+ creators across Instagram, YouTube, TikTok, and X (Twitter).

### **Core Requirements**
- **Scale**: Handle 250M+ creator profiles with daily updates
- **Platforms**: Instagram, YouTube, TikTok, X (Twitter)
- **Search**: Semantic search with AI-powered ranking
- **Latency**: <500ms for search queries, <2s for complex filters
- **Availability**: 99.9% uptime SLA

### **Key Design Principles**
1. **AI-First**: Embeddings for semantic search, LLMs for enrichment
2. **Cost-Conscious**: Optimize for cost at scale (target: <$0.10 per creator/year)
3. **Incremental Complexity**: Start simple, add sophistication post-PMF
4. **Data Quality**: Prioritize accuracy and freshness over volume

---

## 2. Data Model & Partitioning

### **2.1 Multi-Database Strategy**

We use a **polyglot persistence** approach optimized for different access patterns:

| Database | Use Case | Data Volume | Access Pattern |
|----------|----------|-------------|----------------|
| **PostgreSQL (Aurora)** | Structured creator profiles, relationships | 250M rows | Read-heavy, complex queries |
| **DynamoDB** | Raw API responses, audit logs | 1B+ items | Write-heavy, time-series |
| **S3** | Media files, data lake, backups | 50TB+ | Archival, batch analytics |
| **Pinecone** | Vector embeddings for search | 250M vectors | Similarity search |
| **Redis** | Cache, session store, rate limits | 10GB | Ultra-low latency reads |

### **2.2 PostgreSQL Schema Design**

#### **Core Tables**

```sql
-- Creators table (partitioned by platform)
CREATE TABLE creators (
    creator_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(20) NOT NULL,
    platform_user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    bio TEXT,
    profile_image_url TEXT,
    
    -- Metrics
    followers_count BIGINT DEFAULT 0,
    following_count BIGINT DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2),
    avg_views BIGINT,
    avg_likes BIGINT,
    avg_comments BIGINT,
    
    -- Classification
    primary_niche VARCHAR(100),
    secondary_niches TEXT[], -- Array of niches
    content_languages TEXT[],
    audience_countries TEXT[],
    
    -- Metadata
    verified BOOLEAN DEFAULT FALSE,
    is_business BOOLEAN DEFAULT FALSE,
    contact_email VARCHAR(255),
    external_url TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_scraped_at TIMESTAMP,
    
    -- Constraints
    UNIQUE(platform, platform_user_id)
) PARTITION BY LIST (platform);

-- Create partitions for each platform
CREATE TABLE creators_instagram PARTITION OF creators FOR VALUES IN ('instagram');
CREATE TABLE creators_youtube PARTITION OF creators FOR VALUES IN ('youtube');
CREATE TABLE creators_tiktok PARTITION OF creators FOR VALUES IN ('tiktok');
CREATE TABLE creators_twitter PARTITION OF creators FOR VALUES IN ('twitter');

-- Indexes for common queries
CREATE INDEX idx_creators_followers ON creators(followers_count DESC);
CREATE INDEX idx_creators_niche ON creators(primary_niche);
CREATE INDEX idx_creators_engagement ON creators(engagement_rate DESC);
CREATE INDEX idx_creators_updated ON creators(updated_at);
```

#### **Identity Resolution Table**

```sql
-- Links same creator across platforms
CREATE TABLE creator_identities (
    identity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_creator_id UUID REFERENCES creators(creator_id),
    confidence_score DECIMAL(3,2), -- 0.00 to 1.00
    resolution_method VARCHAR(50), -- 'email', 'embedding', 'manual', 'url'
    created_at TIMESTAMP DEFAULT NOW(),
    verified BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_identity_canonical ON creator_identities(canonical_creator_id);
```

#### **Content Samples Table**

```sql
-- Store sample posts for analysis
CREATE TABLE content_samples (
    sample_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID REFERENCES creators(creator_id),
    platform VARCHAR(20),
    post_id VARCHAR(255),
    post_type VARCHAR(50), -- 'image', 'video', 'carousel', 'reel'
    caption TEXT,
    media_urls TEXT[],
    hashtags TEXT[],
    mentions TEXT[],
    
    -- Metrics
    likes_count BIGINT,
    comments_count BIGINT,
    shares_count BIGINT,
    views_count BIGINT,
    
    posted_at TIMESTAMP,
    scraped_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (posted_at);

-- Partition by month for efficient time-based queries
CREATE TABLE content_samples_2025_11 PARTITION OF content_samples
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
```

### **2.3 DynamoDB Schema**

Used for **high-throughput writes** during ingestion:

```json
{
  "TableName": "RawAPIResponses",
  "KeySchema": [
    { "AttributeName": "platform_user_id", "KeyType": "HASH" },
    { "AttributeName": "scraped_timestamp", "KeyType": "RANGE" }
  ],
  "AttributeDefinitions": [
    { "AttributeName": "platform_user_id", "AttributeType": "S" },
    { "AttributeName": "scraped_timestamp", "AttributeType": "N" },
    { "AttributeName": "platform", "AttributeType": "S" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "PlatformIndex",
      "KeySchema": [
        { "AttributeName": "platform", "KeyType": "HASH" },
        { "AttributeName": "scraped_timestamp", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    }
  ],
  "BillingMode": "PAY_PER_REQUEST",
  "StreamSpecification": {
    "StreamEnabled": true,
    "StreamViewType": "NEW_AND_OLD_IMAGES"
  },
  "TimeToLiveSpecification": {
    "Enabled": true,
    "AttributeName": "ttl"
  }
}
```

**Benefits**:
- **Unlimited write throughput** for parallel ingestion
- **TTL**: Auto-delete old raw data after 90 days
- **DynamoDB Streams**: Trigger Lambda for real-time processing

### **2.4 Vector Database (Pinecone)**

```javascript
// Pinecone index configuration
{
  name: "creator-embeddings",
  dimension: 1536, // OpenAI text-embedding-3-small
  metric: "cosine",
  pods: 4, // Scale based on QPS
  replicas: 2, // High availability
  pod_type: "p1.x1", // Performance tier
  metadata_config: {
    indexed: ["platform", "primary_niche", "followers_count", "country"]
  }
}
```

**Metadata stored with each vector**:
```json
{
  "creator_id": "uuid",
  "platform": "instagram",
  "username": "fitness_guru",
  "primary_niche": "fitness",
  "followers_count": 500000,
  "engagement_rate": 4.5,
  "country": "IN"
}
```

### **2.5 Partitioning Strategy**

#### **Horizontal Partitioning (Sharding)**

At **50M+ creators**, we implement sharding:

```
Shard Key: HASH(creator_id) % num_shards

Shard 1: creator_id ending in 0-3
Shard 2: creator_id ending in 4-7
Shard 3: creator_id ending in 8-B
Shard 4: creator_id ending in C-F
```

#### **Vertical Partitioning**

Separate **hot** and **cold** data:

```sql
-- Hot data (frequently accessed)
CREATE TABLE creators_hot (
    creator_id UUID PRIMARY KEY,
    username VARCHAR(255),
    followers_count BIGINT,
    engagement_rate DECIMAL(5,2),
    primary_niche VARCHAR(100),
    updated_at TIMESTAMP
);

-- Cold data (rarely accessed)
CREATE TABLE creators_cold (
    creator_id UUID PRIMARY KEY REFERENCES creators_hot(creator_id),
    bio TEXT,
    contact_email VARCHAR(255),
    external_url TEXT,
    audience_demographics JSONB,
    historical_metrics JSONB
);
```

---

## 3. Ingestion Architecture

### **3.1 High-Level Flow**

```
┌─────────────────────────────────────────────────────────────┐
│                     INGESTION PIPELINE                       │
└─────────────────────────────────────────────────────────────┘

1. Airflow DAG (Scheduler)
   │
   ├─> Task 1: Fetch Creator IDs from seed lists
   │
   ├─> Task 2: Distribute to SQS queues (by platform)
   │
   ├─> Task 3: ECS Workers pull from SQS
   │      │
   │      ├─> Instagram Worker (Rate: 200 req/hr/token)
   │      ├─> YouTube Worker (Rate: 10,000 req/day)
   │      ├─> TikTok Worker (Rate: 100 req/min)
   │      └─> Twitter Worker (Rate: 300 req/15min)
   │
   ├─> Task 4: Write raw data to DynamoDB
   │
   ├─> Task 5: DynamoDB Stream → Lambda → Parse & Validate
   │
   └─> Task 6: Write to PostgreSQL + S3
```

### **3.2 Rate Limiting Strategy**

Each platform has different API quotas. We use **token bucket algorithm**:

```javascript
// rate-limiter.js
const Bottleneck = require('bottleneck');

const rateLimiters = {
  instagram: new Bottleneck({
    reservoir: 200, // Initial tokens
    reservoirRefreshAmount: 200,
    reservoirRefreshInterval: 60 * 60 * 1000, // 1 hour
    maxConcurrent: 5,
    minTime: 100 // Min 100ms between requests
  }),
  
  youtube: new Bottleneck({
    reservoir: 10000,
    reservoirRefreshAmount: 10000,
    reservoirRefreshInterval: 24 * 60 * 60 * 1000, // 1 day
    maxConcurrent: 10,
    minTime: 10
  }),
  
  tiktok: new Bottleneck({
    reservoir: 100,
    reservoirRefreshAmount: 100,
    reservoirRefreshInterval: 60 * 1000, // 1 minute
    maxConcurrent: 3,
    minTime: 600
  }),
  
  twitter: new Bottleneck({
    reservoir: 300,
    reservoirRefreshAmount: 300,
    reservoirRefreshInterval: 15 * 60 * 1000, // 15 minutes
    maxConcurrent: 5,
    minTime: 50
  })
};

module.exports = rateLimiters;
```

### **3.3 Ingestion Cadence**

| Creator Tier | Followers | Update Frequency | Reasoning |
|--------------|-----------|------------------|-----------|
| **Mega** | >1M | Every 6 hours | High-value, fast-changing metrics |
| **Macro** | 100K-1M | Daily | Moderate change rate |
| **Micro** | 10K-100K | Weekly | Lower priority, slower growth |
| **Nano** | <10K | Monthly | Least critical, minimal changes |

**Implementation**:
```sql
-- Priority queue based on last_scraped_at and tier
SELECT creator_id, platform, platform_user_id
FROM creators
WHERE (
    (followers_count > 1000000 AND last_scraped_at < NOW() - INTERVAL '6 hours')
    OR (followers_count BETWEEN 100000 AND 1000000 AND last_scraped_at < NOW() - INTERVAL '1 day')
    OR (followers_count BETWEEN 10000 AND 100000 AND last_scraped_at < NOW() - INTERVAL '7 days')
    OR (followers_count < 10000 AND last_scraped_at < NOW() - INTERVAL '30 days')
)
ORDER BY followers_count DESC
LIMIT 10000;
```

### **3.4 Retry & Error Handling**

```javascript
// Exponential backoff with jitter
async function fetchWithRetry(url, platform, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await rateLimiters[platform].schedule(() => 
        axios.get(url, { timeout: 10000 })
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        // Rate limited - wait longer
        const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
        const jitter = Math.random() * 1000;
        await sleep(backoff + jitter);
      } else if (error.response?.status === 404) {
        // Creator deleted/not found - mark as inactive
        await markCreatorInactive(creatorId);
        return null;
      } else if (attempt === maxRetries) {
        // Final attempt failed - send to DLQ
        await sendToDeadLetterQueue({ url, platform, error: error.message });
        throw error;
      }
    }
  }
}
```

### **3.5 Backfill Strategy**

For initial ingestion of 250M creators:

```python
# Airflow DAG for backfill
from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta

def backfill_batch(batch_id, batch_size=100000):
    """Process batch of creator IDs"""
    offset = batch_id * batch_size
    creator_ids = fetch_creator_ids(offset, batch_size)
    
    # Send to SQS for processing
    send_to_sqs(creator_ids, queue='backfill-queue')

# Create 2500 tasks for 250M creators (100K per task)
backfill_dag = DAG(
    'creator_backfill',
    schedule_interval=None,  # Manual trigger
    start_date=datetime(2025, 1, 1),
    catchup=False
)

for batch_id in range(2500):
    task = PythonOperator(
        task_id=f'backfill_batch_{batch_id}',
        python_callable=backfill_batch,
        op_kwargs={'batch_id': batch_id},
        dag=backfill_dag
    )
```

**Timeline**: 250M creators at 10K/hour = **25,000 hours = ~3 years**

**Optimization**: Parallelize across 100 workers = **10 days** for initial backfill

---

## 4. Identity Resolution

### **4.1 The Challenge**

The same creator exists on multiple platforms with different usernames:

```
Instagram: @fitness_guru_india (500K followers)
YouTube: Fitness Guru (300K subscribers)
TikTok: @fitnessguru (1M followers)
Twitter: @FitnessGuruIN (50K followers)
```

**Goal**: Link these as one canonical creator profile.

### **4.2 Resolution Strategies**

#### **Strategy 1: Email/URL Matching (High Confidence)**

```javascript
async function resolveByContact(creator) {
  const { contact_email, external_url } = creator;
  
  if (contact_email) {
    // Find other creators with same email
    const matches = await db.query(
      'SELECT * FROM creators WHERE contact_email = $1 AND creator_id != $2',
      [contact_email, creator.creator_id]
    );
    
    if (matches.rows.length > 0) {
      return { matches: matches.rows, confidence: 0.95, method: 'email' };
    }
  }
  
  if (external_url) {
    // Normalize URL and match
    const normalizedUrl = normalizeUrl(external_url);
    const matches = await db.query(
      'SELECT * FROM creators WHERE external_url LIKE $1',
      [`%${normalizedUrl}%`]
    );
    
    if (matches.rows.length > 0) {
      return { matches: matches.rows, confidence: 0.85, method: 'url' };
    }
  }
  
  return null;
}
```

#### **Strategy 2: Embedding Similarity (Medium Confidence)**

```javascript
async function resolveByEmbedding(creator) {
  // Generate embedding from bio + username + display_name
  const text = `${creator.username} ${creator.display_name} ${creator.bio}`;
  const embedding = await generateEmbedding(text);
  
  // Search Pinecone for similar creators on OTHER platforms
  const results = await pineconeIndex.query({
    vector: embedding,
    topK: 10,
    filter: {
      platform: { $ne: creator.platform } // Different platform
    }
  });
  
  // High similarity (>0.85) suggests same person
  const highConfidenceMatches = results.matches.filter(m => m.score > 0.85);
  
  if (highConfidenceMatches.length > 0) {
    return {
      matches: highConfidenceMatches,
      confidence: highConfidenceMatches[0].score,
      method: 'embedding'
    };
  }
  
  return null;
}
```

#### **Strategy 3: Username Similarity (Low Confidence)**

```javascript
function resolveByUsername(creator) {
  // Normalize username (remove special chars, lowercase)
  const normalized = creator.username.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Fuzzy match using Levenshtein distance
  const matches = await db.query(`
    SELECT *, levenshtein($1, LOWER(REGEXP_REPLACE(username, '[^a-zA-Z0-9]', '', 'g'))) as distance
    FROM creators
    WHERE platform != $2
      AND levenshtein($1, LOWER(REGEXP_REPLACE(username, '[^a-zA-Z0-9]', '', 'g'))) < 3
    ORDER BY distance ASC
    LIMIT 5
  `, [normalized, creator.platform]);
  
  if (matches.rows.length > 0) {
    return {
      matches: matches.rows,
      confidence: 0.60,
      method: 'username_fuzzy'
    };
  }
  
  return null;
}
```

### **4.3 Resolution Pipeline**

```javascript
async function resolveIdentity(creator) {
  // Try strategies in order of confidence
  let result = await resolveByContact(creator);
  if (result && result.confidence > 0.90) {
    return await createIdentityLink(creator, result);
  }
  
  result = await resolveByEmbedding(creator);
  if (result && result.confidence > 0.85) {
    return await createIdentityLink(creator, result);
  }
  
  result = await resolveByUsername(creator);
  if (result && result.confidence > 0.70) {
    // Flag for manual review
    return await flagForManualReview(creator, result);
  }
  
  // No match found - create new canonical identity
  return await createCanonicalIdentity(creator);
}
```

### **4.4 Canonical Profile Aggregation**

Once linked, aggregate metrics across platforms:

```javascript
async function buildCanonicalProfile(identityId) {
  const linkedCreators = await db.query(
    'SELECT c.* FROM creators c JOIN creator_identities ci ON c.creator_id = ci.canonical_creator_id WHERE ci.identity_id = $1',
    [identityId]
  );
  
  return {
    identity_id: identityId,
    platforms: linkedCreators.rows.map(c => c.platform),
    total_followers: linkedCreators.rows.reduce((sum, c) => sum + c.followers_count, 0),
    avg_engagement_rate: linkedCreators.rows.reduce((sum, c) => sum + c.engagement_rate, 0) / linkedCreators.rows.length,
    primary_platform: linkedCreators.rows.sort((a, b) => b.followers_count - a.followers_count)[0].platform,
    niches: [...new Set(linkedCreators.rows.flatMap(c => [c.primary_niche, ...c.secondary_niches]))],
    verified_on_any: linkedCreators.rows.some(c => c.verified)
  };
}
```

---

## 5. Retrieval & Ranking

### **5.1 Search Architecture**

**Hybrid Search**: Combine vector similarity + keyword filters + business logic

```
User Query: "fitness influencers in India with 100K+ followers"
    │
    ├─> 1. Generate embedding for "fitness influencers"
    │
    ├─> 2. Vector search in Pinecone (top 1000 results)
    │      Filter: country = 'IN', followers >= 100K
    │
    ├─> 3. Fetch full profiles from PostgreSQL
    │
    ├─> 4. Apply ranking algorithm
    │      Score = 0.4 * semantic_similarity 
    │            + 0.3 * engagement_rate
    │            + 0.2 * follower_quality_score
    │            + 0.1 * content_freshness
    │
    └─> 5. Return top 50 results
```

### **5.2 Ranking Algorithm**

```javascript
function calculateRankingScore(creator, queryEmbedding, semanticSimilarity) {
  // 1. Semantic relevance (0-1)
  const relevanceScore = semanticSimilarity;
  
  // 2. Engagement quality (0-1)
  const engagementScore = Math.min(creator.engagement_rate / 10, 1);
  
  // 3. Follower quality (0-1)
  // Penalize suspicious growth patterns
  const followerQualityScore = calculateFollowerQuality(creator);
  
  // 4. Content freshness (0-1)
  const daysSinceLastPost = (Date.now() - creator.last_post_at) / (1000 * 60 * 60 * 24);
  const freshnessScore = Math.max(0, 1 - (daysSinceLastPost / 30));
  
  // 5. Verification boost
  const verificationBoost = creator.verified ? 1.1 : 1.0;
  
  // Weighted combination
  const finalScore = (
    0.40 * relevanceScore +
    0.30 * engagementScore +
    0.20 * followerQualityScore +
    0.10 * freshnessScore
  ) * verificationBoost;
  
  return finalScore;
}

function calculateFollowerQuality(creator) {
  // Check for suspicious patterns
  const followingToFollowersRatio = creator.following_count / creator.followers_count;
  const postsToFollowersRatio = creator.posts_count / creator.followers_count;
  
  let qualityScore = 1.0;
  
  // Red flags
  if (followingToFollowersRatio > 2) qualityScore -= 0.3; // Following way more than followers
  if (postsToFollowersRatio < 0.001) qualityScore -= 0.2; // Too few posts for follower count
  if (creator.engagement_rate < 0.5) qualityScore -= 0.3; // Very low engagement
  
  return Math.max(0, qualityScore);
}
```

### **5.3 Query Optimization**

```javascript
// API endpoint with caching
app.post('/api/search', async (req, res) => {
  const { query, filters, page = 1, limit = 20 } = req.body;
  
  // Generate cache key
  const cacheKey = `search:${hash({ query, filters, page, limit })}`;
  
  // Check Redis cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return res.json(JSON.parse(cached));
  }
  
  // Generate embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // Vector search with filters
  const vectorResults = await pineconeIndex.query({
    vector: queryEmbedding,
    topK: 1000,
    filter: buildPineconeFilter(filters),
    includeMetadata: true
  });
  
  // Fetch full profiles
  const creatorIds = vectorResults.matches.map(m => m.metadata.creator_id);
  const creators = await db.query(
    'SELECT * FROM creators WHERE creator_id = ANY($1)',
    [creatorIds]
  );
  
  // Rank results
  const rankedResults = creators.rows
    .map(creator => ({
      ...creator,
      score: calculateRankingScore(
        creator,
        queryEmbedding,
        vectorResults.matches.find(m => m.metadata.creator_id === creator.creator_id).score
      )
    }))
    .sort((a, b) => b.score - a.score)
    .slice((page - 1) * limit, page * limit);
  
  // Cache for 5 minutes
  await redis.setex(cacheKey, 300, JSON.stringify(rankedResults));
  
  res.json(rankedResults);
});
```

---

## 6. AI Integration

### **6.1 Embeddings Pipeline**

```javascript
// embeddings-generator.js
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateCreatorEmbedding(creator) {
  // Construct rich text representation
  const text = `
    Username: ${creator.username}
    Display Name: ${creator.display_name}
    Bio: ${creator.bio}
    Primary Niche: ${creator.primary_niche}
    Platform: ${creator.platform}
    Content Languages: ${creator.content_languages.join(', ')}
    Audience Countries: ${creator.audience_countries.join(', ')}
  `.trim();
  
  // Generate embedding
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  
  const embedding = response.data[0].embedding;
  
  // Store in Pinecone
  await pineconeIndex.upsert([{
    id: creator.creator_id,
    values: embedding,
    metadata: {
      creator_id: creator.creator_id,
      platform: creator.platform,
      username: creator.username,
      primary_niche: creator.primary_niche,
      followers_count: creator.followers_count,
      engagement_rate: creator.engagement_rate,
      country: creator.audience_countries[0] || 'unknown'
    }
  }]);
  
  return embedding;
}

// Batch processing for efficiency
async function batchGenerateEmbeddings(creators, batchSize = 100) {
  for (let i = 0; i < creators.length; i += batchSize) {
    const batch = creators.slice(i, i + batchSize);
    await Promise.all(batch.map(generateCreatorEmbedding));
    
    // Rate limiting: OpenAI allows 3000 RPM for embeddings
    await sleep(2000); // 2 seconds between batches
  }
}
```

### **6.2 LLM-Based Classification**

```javascript
// llm-classifier.js
async function classifyCreatorNiche(creator) {
  const prompt = `
You are an expert at categorizing social media influencers.

Analyze this creator profile and determine:
1. Primary niche (single category)
2. Secondary niches (up to 3)
3. Content themes (up to 5 keywords)
4. Target audience demographics

Creator Profile:
- Username: ${creator.username}
- Bio: ${creator.bio}
- Sample Post Captions: ${creator.sample_captions.join('\n')}

Respond in JSON format:
{
  "primary_niche": "...",
  "secondary_niches": ["...", "..."],
  "content_themes": ["...", "...", "..."],
  "target_audience": {
    "age_range": "...",
    "gender": "...",
    "interests": ["...", "..."]
  }
}
  `.trim();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // Cheaper model for classification
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3
  });
  
  const classification = JSON.parse(response.choices[0].message.content);
  
  // Update database
  await db.query(`
    UPDATE creators
    SET primary_niche = $1,
        secondary_niches = $2,
        content_themes = $3,
        target_audience = $4
    WHERE creator_id = $5
  `, [
    classification.primary_niche,
    classification.secondary_niches,
    classification.content_themes,
    classification.target_audience,
    creator.creator_id
  ]);
  
  return classification;
}
```

### **6.3 Metadata Extraction**

```javascript
// Extract structured data from unstructured bios
async function extractMetadata(bio) {
  const prompt = `
Extract structured information from this Instagram bio:

"${bio}"

Return JSON with:
- location (city, country)
- contact_email
- collaboration_keywords (e.g., "collab", "PR", "sponsorship")
- interests (array of topics)
- profession (if mentioned)
  `;
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' }
  });
  
  return JSON.parse(response.choices[0].message.content);
}
```

### **6.4 AI Cost Optimization**

| Task | Model | Cost per 1M Creators | Optimization |
|------|-------|---------------------|--------------|
| **Embeddings** | text-embedding-3-small | $50 | Batch processing, cache for 30 days |
| **Classification** | gpt-4o-mini | $150 | Only for new/updated creators |
| **Metadata Extraction** | gpt-4o-mini | $100 | Only if bio changed |
| **Total** | - | **$300** | **$0.0003 per creator** |

---

## 7. Monitoring & Observability

### **7.1 Key Metrics**

```javascript
// CloudWatch metrics
const metrics = {
  // Ingestion
  'ingestion.creators_per_hour': 10000,
  'ingestion.api_errors_rate': 0.02, // 2%
  'ingestion.rate_limit_hits': 5,
  
  // Data Quality
  'data.completeness_score': 0.95, // % of fields populated
  'data.duplicate_rate': 0.001, // 0.1%
  'data.stale_profiles': 1000, // Not updated in 30 days
  
  // Search Performance
  'search.p50_latency_ms': 250,
  'search.p95_latency_ms': 800,
  'search.p99_latency_ms': 1500,
  'search.cache_hit_rate': 0.75,
  
  // AI Pipeline
  'ai.embeddings_generated_per_hour': 5000,
  'ai.classification_accuracy': 0.92,
  'ai.api_cost_per_day': 15.50,
  
  // Business Metrics
  'business.total_creators': 250000000,
  'business.active_creators': 180000000, // Posted in last 30 days
  'business.verified_creators': 500000
};
```

### **7.2 Alerting**

```javascript
// CloudWatch Alarms
const alarms = [
  {
    name: 'HighAPIErrorRate',
    metric: 'ingestion.api_errors_rate',
    threshold: 0.05, // 5%
    action: 'PagerDuty + Slack'
  },
  {
    name: 'SearchLatencyHigh',
    metric: 'search.p95_latency_ms',
    threshold: 1000,
    action: 'Slack'
  },
  {
    name: 'AIBudgetExceeded',
    metric: 'ai.api_cost_per_day',
    threshold: 50,
    action: 'Email + Pause AI jobs'
  },
  {
    name: 'DatabaseConnectionPoolExhausted',
    metric: 'db.connection_pool_usage',
    threshold: 0.90,
    action: 'Auto-scale RDS + PagerDuty'
  }
];
```

### **7.3 Logging Strategy**

```javascript
// winston logger
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'increator-api' },
  transports: [
    // CloudWatch Logs
    new winston.transports.Console(),
    
    // S3 for long-term storage
    new winston.transports.Stream({
      stream: s3Stream,
      level: 'error'
    })
  ]
});

// Structured logging
logger.info('Creator ingested', {
  creator_id: 'uuid',
  platform: 'instagram',
  followers_count: 500000,
  duration_ms: 1250,
  api_calls: 3
});
```

---

## 8. Security & Multi-Tenancy

### **8.1 Authentication & Authorization**

```javascript
// JWT-based API authentication
const jwt = require('jsonwebtoken');

function authenticateRequest(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.tenantId = decoded.tenant_id;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Row-level security in PostgreSQL
await db.query(`
  CREATE POLICY tenant_isolation ON creators
  USING (tenant_id = current_setting('app.current_tenant')::UUID);
  
  ALTER TABLE creators ENABLE ROW LEVEL SECURITY;
`);

// Set tenant context for each request
app.use(async (req, res, next) => {
  if (req.tenantId) {
    await db.query('SET app.current_tenant = $1', [req.tenantId]);
  }
  next();
});
```

### **8.2 Rate Limiting (Per-Tenant)**

```javascript
const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: async (req) => {
    // Different limits per tenant tier
    const tenant = await getTenant(req.tenantId);
    return tenant.tier === 'enterprise' ? 10000 : 1000;
  },
  keyGenerator: (req) => req.tenantId,
  message: 'Too many requests from this tenant'
});

app.use('/api/', apiLimiter);
```

### **8.3 Data Encryption**

- **At Rest**: RDS encryption, S3 server-side encryption (SSE-S3)
- **In Transit**: TLS 1.3 for all API calls
- **Sensitive Fields**: PII encrypted with AWS KMS

```javascript
const AWS = require('aws-sdk');
const kms = new AWS.KMS();

async function encryptPII(data) {
  const params = {
    KeyId: process.env.KMS_KEY_ID,
    Plaintext: JSON.stringify(data)
  };
  
  const encrypted = await kms.encrypt(params).promise();
  return encrypted.CiphertextBlob.toString('base64');
}
```

---

## 9. Cost Analysis

### **9.1 Cost Breakdown (Monthly)**

#### **1 Million Creators**

| Service | Usage | Cost |
|---------|-------|------|
| **RDS Aurora (PostgreSQL)** | db.r5.large (2 vCPU, 16GB) | $175 |
| **DynamoDB** | 10M writes, 1M reads | $15 |
| **S3** | 100GB storage, 1M requests | $5 |
| **Pinecone** | 1M vectors, p1.x1 pod | $70 |
| **OpenAI API** | 1M embeddings/month | $50 |
| **ECS Fargate** | 5 tasks, 2 vCPU each | $150 |
| **CloudWatch** | Logs + metrics | $20 |
| **Data Transfer** | 500GB/month | $45 |
| **Total** | - | **$530/month** |

**Cost per creator**: **$0.53/year**

#### **50 Million Creators**

| Service | Usage | Cost |
|---------|-------|------|
| **RDS Aurora** | db.r5.4xlarge (16 vCPU, 128GB) + 2 read replicas | $1,800 |
| **DynamoDB** | 500M writes, 50M reads | $650 |
| **S3** | 5TB storage, 50M requests | $150 |
| **Pinecone** | 50M vectors, 4x p1.x1 pods | $1,120 |
| **OpenAI API** | 50M embeddings/month | $2,500 |
| **ECS Fargate** | 50 tasks | $1,500 |
| **ElastiCache Redis** | cache.r5.xlarge | $200 |
| **CloudWatch** | - | $100 |
| **Data Transfer** | 10TB/month | $900 |
| **Total** | - | **$8,920/month** |

**Cost per creator**: **$0.21/year**

#### **250 Million Creators**

| Service | Usage | Cost |
|---------|-------|------|
| **RDS Aurora** | 4x db.r5.8xlarge (sharded) + 8 read replicas | $12,000 |
| **DynamoDB** | 2.5B writes, 250M reads | $3,200 |
| **S3** | 25TB storage, 250M requests | $700 |
| **Pinecone** | 250M vectors, 16x p1.x2 pods | $8,960 |
| **OpenAI API** | 250M embeddings/month | $12,500 |
| **ECS Fargate** | 200 tasks | $6,000 |
| **ElastiCache Redis** | 5x cache.r5.4xlarge (cluster) | $2,500 |
| **CloudFront CDN** | 50TB/month | $4,000 |
| **CloudWatch** | - | $500 |
| **Data Transfer** | 50TB/month | $4,500 |
| **Total** | - | **$54,860/month** |

**Cost per creator**: **$0.26/year**

### **9.2 Cost Optimization Strategies**

1. **Reserved Instances**: Save 40% on RDS/ElastiCache
2. **S3 Intelligent Tiering**: Auto-move cold data to Glacier
3. **Embedding Caching**: Regenerate only when bio changes
4. **Spot Instances**: Use for batch jobs (70% savings)
5. **Compression**: Gzip API responses, reduce transfer costs

---

## Conclusion

This architecture balances **scalability**, **cost-efficiency**, and **AI-powered intelligence** to build a world-class influencer discovery platform. The design is pragmatic—starting simple and adding complexity as we prove product-market fit.

**Key Takeaways**:
- **Polyglot persistence** for optimal performance
- **AI-first** approach with embeddings and LLMs
- **Cost-conscious** scaling from 1M to 250M creators
- **Production-ready** with monitoring, security, and multi-tenancy

---

**Next Steps**: See `tradeoffs-and-roadmap.md` for MVP prioritization and 12-month scaling plan.
