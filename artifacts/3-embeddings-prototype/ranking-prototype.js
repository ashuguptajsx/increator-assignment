/**
 * InCreator AI - Embeddings-Based Ranking Prototype
 * 
 * This prototype demonstrates:
 * 1. Generating embeddings for creator profiles
 * 2. Semantic search using vector similarity
 * 3. Hybrid ranking (embeddings + business metrics)
 * 4. Identity resolution using embedding similarity
 */

const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

// ==================== CONFIGURATION ====================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-...'
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || 'pcsk_...'
});

// ==================== SAMPLE DATA ====================

const sampleCreators = [
  {
    creator_id: '1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p',
    platform: 'instagram',
    username: 'fitness_guru_india',
    display_name: 'Fitness Guru',
    bio: 'Personal trainer and nutrition coach. Helping you achieve your fitness goals 💪 | DM for online coaching',
    followers_count: 500000,
    engagement_rate: 4.5,
    primary_niche: 'fitness',
    content_languages: ['en', 'hi'],
    audience_countries: ['IN', 'US', 'GB'],
    verified: true
  },
  {
    creator_id: '2b3c4d5e-6f7g-8h9i-0j1k-2l3m4n5o6p7q',
    platform: 'youtube',
    username: 'TechReviewsHD',
    display_name: 'Tech Reviews HD',
    bio: 'Honest tech reviews and unboxing videos. Latest smartphones, laptops, and gadgets. Subscribe for weekly content!',
    followers_count: 1200000,
    engagement_rate: 3.2,
    primary_niche: 'technology',
    content_languages: ['en'],
    audience_countries: ['US', 'IN', 'CA'],
    verified: true
  },
  {
    creator_id: '3c4d5e6f-7g8h-9i0j-1k2l-3m4n5o6p7q8r',
    platform: 'tiktok',
    username: 'cooking_with_love',
    display_name: 'Cooking With Love',
    bio: 'Easy recipes for busy people 🍳 | Quick meals under 30 mins | Follow for daily recipe inspiration',
    followers_count: 3000000,
    engagement_rate: 8.5,
    primary_niche: 'food',
    content_languages: ['en'],
    audience_countries: ['US', 'GB', 'AU'],
    verified: true
  },
  {
    creator_id: '4d5e6f7g-8h9i-0j1k-2l3m-4n5o6p7q8r9s',
    platform: 'instagram',
    username: 'travel_wanderer',
    display_name: 'Travel Wanderer',
    bio: 'Exploring the world one city at a time 🌍 | Travel tips and hidden gems | Based in Mumbai',
    followers_count: 250000,
    engagement_rate: 5.2,
    primary_niche: 'travel',
    content_languages: ['en'],
    audience_countries: ['IN', 'US', 'AE'],
    verified: false
  },
  {
    creator_id: '5e6f7g8h-9i0j-1k2l-3m4n-5o6p7q8r9s0t',
    platform: 'instagram',
    username: 'gym_motivation_daily',
    display_name: 'Gym Motivation',
    bio: 'Daily workout routines and fitness motivation. Transform your body and mind. Join our fitness community!',
    followers_count: 350000,
    engagement_rate: 6.1,
    primary_niche: 'fitness',
    content_languages: ['en'],
    audience_countries: ['US', 'IN', 'GB'],
    verified: false
  },
  {
    creator_id: '6f7g8h9i-0j1k-2l3m-4n5o-6p7q8r9s0t1u',
    platform: 'youtube',
    username: 'GadgetUnboxing',
    display_name: 'Gadget Unboxing',
    bio: 'Unboxing the latest tech gadgets and electronics. First impressions and hands-on reviews.',
    followers_count: 800000,
    engagement_rate: 4.8,
    primary_niche: 'technology',
    content_languages: ['en'],
    audience_countries: ['US', 'IN', 'GB'],
    verified: false
  }
];

// ==================== EMBEDDING GENERATION ====================

/**
 * Build rich text representation for embedding
 */
function buildEmbeddingText(creator) {
  const parts = [
    `Username: ${creator.username}`,
    `Name: ${creator.display_name}`,
    `Bio: ${creator.bio}`,
    `Niche: ${creator.primary_niche}`,
    `Platform: ${creator.platform}`,
    `Languages: ${creator.content_languages.join(', ')}`,
    `Audience: ${creator.audience_countries.join(', ')}`
  ];
  
  return parts.join('\n');
}

/**
 * Generate embedding for a single creator
 */
async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error.message);
    // Return mock embedding for demo purposes
    return Array(1536).fill(0).map(() => Math.random() * 2 - 1);
  }
}

/**
 * Generate embeddings for all creators (batch)
 */
async function generateCreatorEmbeddings(creators) {
  console.log(`\n📊 Generating embeddings for ${creators.length} creators...\n`);
  
  const embeddings = [];
  
  for (const creator of creators) {
    const text = buildEmbeddingText(creator);
    console.log(`Processing: ${creator.username} (${creator.platform})`);
    
    const embedding = await generateEmbedding(text);
    
    embeddings.push({
      id: creator.creator_id,
      values: embedding,
      metadata: {
        creator_id: creator.creator_id,
        platform: creator.platform,
        username: creator.username,
        display_name: creator.display_name,
        primary_niche: creator.primary_niche,
        followers_count: creator.followers_count,
        engagement_rate: creator.engagement_rate,
        verified: creator.verified
      }
    });
    
    // Rate limiting (avoid hitting API limits)
    await sleep(100);
  }
  
  console.log(`\n✅ Generated ${embeddings.length} embeddings\n`);
  return embeddings;
}

// ==================== VECTOR SIMILARITY ====================

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find most similar creators to a query
 */
async function semanticSearch(queryText, creatorEmbeddings, topK = 5) {
  console.log(`\n🔍 Searching for: "${queryText}"\n`);
  
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(queryText);
  
  // Calculate similarity scores
  const results = creatorEmbeddings.map(creator => ({
    ...creator.metadata,
    similarity_score: cosineSimilarity(queryEmbedding, creator.values)
  }));
  
  // Sort by similarity (descending)
  results.sort((a, b) => b.similarity_score - a.similarity_score);
  
  return results.slice(0, topK);
}

// ==================== HYBRID RANKING ====================

/**
 * Calculate follower quality score
 */
function calculateFollowerQuality(creator) {
  let qualityScore = 1.0;
  
  // High engagement is good
  if (creator.engagement_rate > 5.0) qualityScore += 0.2;
  else if (creator.engagement_rate < 1.0) qualityScore -= 0.3;
  
  // Verification boost
  if (creator.verified) qualityScore += 0.1;
  
  return Math.max(0, Math.min(1, qualityScore));
}

/**
 * Hybrid ranking: Combine semantic similarity + business metrics
 */
function hybridRanking(searchResults, weights = { semantic: 0.5, engagement: 0.3, followers: 0.2 }) {
  // Normalize scores to 0-1 range
  const maxFollowers = Math.max(...searchResults.map(r => r.followers_count));
  const maxEngagement = Math.max(...searchResults.map(r => r.engagement_rate));
  
  const rankedResults = searchResults.map(result => {
    const semanticScore = result.similarity_score;
    const engagementScore = result.engagement_rate / maxEngagement;
    const followersScore = result.followers_count / maxFollowers;
    const qualityScore = calculateFollowerQuality(result);
    
    // Weighted combination
    const finalScore = (
      weights.semantic * semanticScore +
      weights.engagement * engagementScore +
      weights.followers * followersScore
    ) * qualityScore;
    
    return {
      ...result,
      final_score: finalScore,
      score_breakdown: {
        semantic: semanticScore.toFixed(3),
        engagement: engagementScore.toFixed(3),
        followers: followersScore.toFixed(3),
        quality: qualityScore.toFixed(3)
      }
    };
  });
  
  // Sort by final score
  rankedResults.sort((a, b) => b.final_score - a.final_score);
  
  return rankedResults;
}

// ==================== IDENTITY RESOLUTION ====================

/**
 * Find potential cross-platform matches using embeddings
 */
async function findIdentityMatches(creator, allCreatorEmbeddings, threshold = 0.85) {
  const creatorEmbedding = allCreatorEmbeddings.find(e => e.id === creator.creator_id);
  
  if (!creatorEmbedding) return [];
  
  const matches = allCreatorEmbeddings
    .filter(e => e.id !== creator.creator_id && e.metadata.platform !== creator.platform)
    .map(e => ({
      ...e.metadata,
      similarity_score: cosineSimilarity(creatorEmbedding.values, e.values),
      resolution_method: 'embedding'
    }))
    .filter(m => m.similarity_score >= threshold)
    .sort((a, b) => b.similarity_score - a.similarity_score);
  
  return matches;
}

// ==================== DEMO EXECUTION ====================

async function runDemo() {
  console.log('='.repeat(60));
  console.log('  InCreator AI - Embeddings Ranking Prototype');
  console.log('='.repeat(60));
  
  // Step 1: Generate embeddings
  const creatorEmbeddings = await generateCreatorEmbeddings(sampleCreators);
  
  // Step 2: Semantic search examples
  const queries = [
    'fitness trainers who help with workouts',
    'tech reviewers who unbox gadgets',
    'food creators with easy recipes'
  ];
  
  for (const query of queries) {
    const results = await semanticSearch(query, creatorEmbeddings, 3);
    
    console.log(`Query: "${query}"`);
    console.log('-'.repeat(60));
    results.forEach((result, idx) => {
      console.log(`${idx + 1}. @${result.username} (${result.platform})`);
      console.log(`   Similarity: ${(result.similarity_score * 100).toFixed(1)}%`);
      console.log(`   Followers: ${(result.followers_count / 1000).toFixed(0)}K | Engagement: ${result.engagement_rate}%`);
      console.log();
    });
  }
  
  // Step 3: Hybrid ranking demo
  console.log('\n' + '='.repeat(60));
  console.log('  HYBRID RANKING DEMO');
  console.log('='.repeat(60));
  
  const searchQuery = 'fitness influencers';
  const semanticResults = await semanticSearch(searchQuery, creatorEmbeddings, 10);
  const rankedResults = hybridRanking(semanticResults);
  
  console.log(`\nQuery: "${searchQuery}"`);
  console.log('-'.repeat(60));
  rankedResults.forEach((result, idx) => {
    console.log(`${idx + 1}. @${result.username} (${result.platform})`);
    console.log(`   Final Score: ${(result.final_score * 100).toFixed(1)}%`);
    console.log(`   Breakdown: Semantic=${result.score_breakdown.semantic}, Engagement=${result.score_breakdown.engagement}, Followers=${result.score_breakdown.followers}`);
    console.log();
  });
  
  // Step 4: Identity resolution demo
  console.log('\n' + '='.repeat(60));
  console.log('  IDENTITY RESOLUTION DEMO');
  console.log('='.repeat(60));
  
  const testCreator = sampleCreators[0]; // fitness_guru_india
  const matches = await findIdentityMatches(testCreator, creatorEmbeddings, 0.75);
  
  console.log(`\nFinding cross-platform matches for: @${testCreator.username}`);
  console.log('-'.repeat(60));
  
  if (matches.length > 0) {
    matches.forEach((match, idx) => {
      console.log(`${idx + 1}. @${match.username} (${match.platform})`);
      console.log(`   Confidence: ${(match.similarity_score * 100).toFixed(1)}%`);
      console.log(`   Method: ${match.resolution_method}`);
      console.log();
    });
  } else {
    console.log('No high-confidence matches found.\n');
  }
  
  // Step 5: Save results
  const results = {
    timestamp: new Date().toISOString(),
    total_creators: sampleCreators.length,
    sample_queries: queries,
    sample_results: rankedResults.slice(0, 5).map(r => ({
      username: r.username,
      platform: r.platform,
      final_score: r.final_score,
      score_breakdown: r.score_breakdown
    }))
  };
  
  const fs = require('fs');
  fs.writeFileSync(
    __dirname + '/sample-results.json',
    JSON.stringify(results, null, 2)
  );
  
  console.log('='.repeat(60));
  console.log('✅ Demo complete! Results saved to sample-results.json');
  console.log('='.repeat(60));
}

// ==================== UTILITY FUNCTIONS ====================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== EXPORT FOR TESTING ====================

module.exports = {
  generateEmbedding,
  generateCreatorEmbeddings,
  semanticSearch,
  hybridRanking,
  findIdentityMatches,
  cosineSimilarity,
  buildEmbeddingText
};

// Run demo if executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}
