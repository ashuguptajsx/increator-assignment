# Vector Database Configuration
## InCreator AI - Creator Embeddings

---

## 1. Pinecone Configuration

### **Index Specification**

```javascript
{
  name: "creator-embeddings-prod",
  dimension: 1536, // OpenAI text-embedding-3-small
  metric: "cosine", // Cosine similarity for text embeddings
  pods: 4, // Scale based on QPS requirements
  replicas: 2, // High availability
  pod_type: "p1.x1", // Performance tier (1536 dims, 1M vectors per pod)
  metadata_config: {
    indexed: [
      "platform",
      "primary_niche",
      "followers_count",
      "engagement_rate",
      "country",
      "verified"
    ]
  }
}
```

### **Vector Structure**

Each creator is represented as:

```javascript
{
  id: "creator_uuid", // Matches PostgreSQL creator_id
  values: [0.0234, -0.1234, 0.5678, ..., 0.9012], // 1536-dimensional vector
  metadata: {
    creator_id: "uuid",
    platform: "instagram",
    username: "fitness_guru_india",
    display_name: "Fitness Guru",
    primary_niche: "fitness",
    secondary_niches: ["health", "nutrition"],
    followers_count: 500000,
    engagement_rate: 4.5,
    country: "IN",
    verified: true,
    updated_at: 1732694400
  }
}
```

### **Metadata Filtering**

Pinecone allows filtering during queries:

```javascript
// Example: Find fitness influencers in India with 100K+ followers
const results = await index.query({
  vector: queryEmbedding,
  topK: 50,
  filter: {
    primary_niche: { $eq: "fitness" },
    country: { $eq: "IN" },
    followers_count: { $gte: 100000 }
  },
  includeMetadata: true
});
```

### **Scaling Strategy**

| Creators | Pods | Pod Type | QPS | Latency (p95) | Cost/Month |
|----------|------|----------|-----|---------------|------------|
| **1M** | 1 | p1.x1 | 10 | <100ms | $70 |
| **10M** | 2 | p1.x1 | 50 | <100ms | $280 |
| **50M** | 4 | p1.x2 | 200 | <100ms | $1,120 |
| **250M** | 16 | p1.x2 | 1000 | <150ms | $8,960 |

### **Index Management**

```javascript
// Create index
const { Pinecone } = require('@pinecone-database/pinecone');
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

await pinecone.createIndex({
  name: 'creator-embeddings-prod',
  dimension: 1536,
  metric: 'cosine',
  spec: {
    pod: {
      environment: 'us-east-1-aws',
      podType: 'p1.x1',
      pods: 4,
      replicas: 2
    }
  }
});

// Get index
const index = pinecone.index('creator-embeddings-prod');

// Upsert vectors (batch)
await index.upsert([
  {
    id: 'creator_1',
    values: embedding1,
    metadata: { platform: 'instagram', ... }
  },
  {
    id: 'creator_2',
    values: embedding2,
    metadata: { platform: 'youtube', ... }
  }
]);

// Query
const queryResults = await index.query({
  vector: queryEmbedding,
  topK: 20,
  includeMetadata: true
});
```

---

## 2. Alternative: AWS OpenSearch with Vector Search

### **Cluster Configuration**

```json
{
  "ClusterName": "increator-vector-search",
  "EngineVersion": "OpenSearch_2.11",
  "ClusterConfig": {
    "InstanceType": "r6g.xlarge.search",
    "InstanceCount": 3,
    "DedicatedMasterEnabled": true,
    "DedicatedMasterType": "r6g.large.search",
    "DedicatedMasterCount": 3,
    "ZoneAwarenessEnabled": true
  },
  "EBSOptions": {
    "EBSEnabled": true,
    "VolumeType": "gp3",
    "VolumeSize": 500,
    "Iops": 3000
  },
  "EncryptionAtRestOptions": {
    "Enabled": true
  },
  "NodeToNodeEncryptionOptions": {
    "Enabled": true
  }
}
```

### **Index Mapping**

```json
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 512
    }
  },
  "mappings": {
    "properties": {
      "creator_id": { "type": "keyword" },
      "username": { "type": "text" },
      "bio": { "type": "text" },
      "embedding": {
        "type": "knn_vector",
        "dimension": 1536,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "platform": { "type": "keyword" },
      "primary_niche": { "type": "keyword" },
      "followers_count": { "type": "long" },
      "engagement_rate": { "type": "float" },
      "country": { "type": "keyword" },
      "verified": { "type": "boolean" }
    }
  }
}
```

### **Vector Search Query**

```json
{
  "size": 20,
  "query": {
    "bool": {
      "must": [
        {
          "knn": {
            "embedding": {
              "vector": [0.1, 0.2, ...],
              "k": 50
            }
          }
        }
      ],
      "filter": [
        { "term": { "platform": "instagram" } },
        { "term": { "primary_niche": "fitness" } },
        { "range": { "followers_count": { "gte": 100000 } } }
      ]
    }
  }
}
```

### **Cost Comparison: Pinecone vs OpenSearch**

| Scale | Pinecone | OpenSearch | Winner |
|-------|----------|------------|--------|
| **1M creators** | $70/month | $450/month (3x r6g.xlarge) | Pinecone |
| **50M creators** | $1,120/month | $1,800/month (6x r6g.2xlarge) | Pinecone |
| **250M creators** | $8,960/month | $7,200/month (12x r6g.4xlarge) | OpenSearch |

**Recommendation**: Use **Pinecone** for MVP and early scale (<50M). Switch to **OpenSearch** at 100M+ creators for cost savings.

---

## 3. Embedding Generation Pipeline

### **Text Representation Strategy**

```javascript
function buildEmbeddingText(creator) {
  // Construct rich text for better semantic understanding
  const parts = [
    `Username: ${creator.username}`,
    `Name: ${creator.display_name}`,
    `Bio: ${creator.bio}`,
    `Niche: ${creator.primary_niche}`,
    `Platform: ${creator.platform}`,
    `Languages: ${creator.content_languages.join(', ')}`,
    `Audience: ${creator.audience_countries.join(', ')}`
  ];
  
  // Add sample post captions for richer context
  if (creator.sample_captions && creator.sample_captions.length > 0) {
    parts.push(`Sample Content: ${creator.sample_captions.slice(0, 3).join(' | ')}`);
  }
  
  return parts.join('\n');
}
```

### **Batch Processing**

```javascript
const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function batchGenerateEmbeddings(creators, batchSize = 100) {
  const results = [];
  
  for (let i = 0; i < creators.length; i += batchSize) {
    const batch = creators.slice(i, i + batchSize);
    const texts = batch.map(buildEmbeddingText);
    
    // OpenAI allows up to 2048 inputs per request
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    
    // Map embeddings back to creators
    batch.forEach((creator, idx) => {
      results.push({
        id: creator.creator_id,
        values: response.data[idx].embedding,
        metadata: {
          creator_id: creator.creator_id,
          platform: creator.platform,
          username: creator.username,
          primary_niche: creator.primary_niche,
          followers_count: creator.followers_count,
          engagement_rate: creator.engagement_rate,
          country: creator.audience_countries[0] || 'unknown',
          verified: creator.verified,
          updated_at: Math.floor(Date.now() / 1000)
        }
      });
    });
    
    // Rate limiting: OpenAI allows 3000 RPM for embeddings
    await sleep(2000); // 2 seconds between batches
  }
  
  return results;
}

// Upsert to Pinecone in batches of 100
async function upsertToPinecone(vectors) {
  const batchSize = 100;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    await index.upsert(batch);
  }
}
```

### **Update Strategy**

```javascript
// Only regenerate embeddings when bio or niche changes
async function shouldRegenerateEmbedding(creator) {
  // Check if embedding exists
  const existing = await index.fetch([creator.creator_id]);
  
  if (!existing.vectors[creator.creator_id]) {
    return true; // No embedding exists
  }
  
  const existingMeta = existing.vectors[creator.creator_id].metadata;
  
  // Regenerate if bio changed or niche changed
  if (
    creator.bio !== existingMeta.bio ||
    creator.primary_niche !== existingMeta.primary_niche
  ) {
    return true;
  }
  
  // Regenerate if embedding is older than 30 days
  const daysSinceUpdate = (Date.now() / 1000 - existingMeta.updated_at) / 86400;
  if (daysSinceUpdate > 30) {
    return true;
  }
  
  return false;
}
```

---

## 4. Hybrid Search Strategy

Combine **vector similarity** (semantic) with **keyword filters** (structured):

```javascript
async function hybridSearch(query, filters) {
  // 1. Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // 2. Vector search with filters
  const vectorResults = await index.query({
    vector: queryEmbedding,
    topK: 100, // Get more candidates
    filter: buildPineconeFilter(filters),
    includeMetadata: true
  });
  
  // 3. Fetch full profiles from PostgreSQL
  const creatorIds = vectorResults.matches.map(m => m.metadata.creator_id);
  const creators = await db.query(
    'SELECT * FROM creators WHERE creator_id = ANY($1)',
    [creatorIds]
  );
  
  // 4. Rerank with business logic
  const rankedResults = creators.rows.map(creator => {
    const vectorMatch = vectorResults.matches.find(
      m => m.metadata.creator_id === creator.creator_id
    );
    
    return {
      ...creator,
      score: calculateHybridScore(creator, vectorMatch.score, filters)
    };
  }).sort((a, b) => b.score - a.score);
  
  return rankedResults.slice(0, filters.limit || 20);
}

function calculateHybridScore(creator, vectorScore, filters) {
  // Weighted combination
  let score = 0.6 * vectorScore; // Semantic relevance
  
  // Engagement boost
  score += 0.2 * Math.min(creator.engagement_rate / 10, 1);
  
  // Follower quality
  score += 0.1 * calculateFollowerQuality(creator);
  
  // Freshness
  const daysSincePost = (Date.now() - creator.last_post_at) / (1000 * 60 * 60 * 24);
  score += 0.1 * Math.max(0, 1 - daysSincePost / 30);
  
  // Verification boost
  if (creator.verified) score *= 1.1;
  
  return score;
}
```

---

## 5. Monitoring & Optimization

### **Key Metrics**

```javascript
// Track vector search performance
const metrics = {
  'vector_search.latency_p50': 80, // ms
  'vector_search.latency_p95': 150,
  'vector_search.latency_p99': 300,
  'vector_search.qps': 50,
  'vector_search.cache_hit_rate': 0.75,
  
  'embeddings.generated_per_hour': 5000,
  'embeddings.cost_per_1k': 0.00002, // $0.00002 per 1K tokens
  'embeddings.total_vectors': 25000000,
  
  'pinecone.index_fullness': 0.65, // 65% of capacity
  'pinecone.monthly_cost': 1120
};
```

### **Cost Optimization**

1. **Cache embeddings**: Don't regenerate unless bio changes
2. **Batch processing**: Generate 100 embeddings per API call
3. **Incremental updates**: Only update changed creators
4. **Smart refresh**: Prioritize high-value creators (verified, high engagement)

---

## Conclusion

**Recommendation**: Start with **Pinecone** for simplicity and managed infrastructure. Switch to **OpenSearch** at 100M+ creators for cost savings and more control.

**Key Benefits**:
- Semantic search finds relevant creators even with different wording
- Hybrid approach combines AI with business logic
- Metadata filtering enables precise targeting
- Scalable to 250M+ vectors with sub-200ms latency
