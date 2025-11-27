/**
 * Embeddings Generator
 * 
 * Generates vector embeddings for creator profiles using OpenAI API
 * and stores them in Pinecone for semantic search.
 */

const { OpenAI } = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');
const logger = require('../utils/logger');

class EmbeddingsGenerator {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    
    this.index = this.pinecone.index('creator-embeddings-prod');
  }

  /**
   * Build rich text representation for embedding
   */
  buildEmbeddingText(creator) {
    const parts = [
      `Username: ${creator.username}`,
      `Name: ${creator.display_name || creator.username}`,
      `Bio: ${creator.bio || 'No bio'}`,
      `Niche: ${creator.primary_niche || 'Unknown'}`,
      `Platform: ${creator.platform}`,
      `Languages: ${(creator.content_languages || []).join(', ')}`,
      `Audience: ${(creator.audience_countries || []).join(', ')}`
    ];
    
    // Add sample content if available
    if (creator.sample_captions && creator.sample_captions.length > 0) {
      parts.push(`Sample Content: ${creator.sample_captions.slice(0, 3).join(' | ')}`);
    }
    
    return parts.join('\n');
  }

  /**
   * Generate embedding for a single creator
   */
  async generateEmbedding(creator) {
    try {
      const text = this.buildEmbeddingText(creator);
      
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      
      const embedding = response.data[0].embedding;
      
      logger.info(`Generated embedding for ${creator.username}`, {
        creator_id: creator.creator_id,
        platform: creator.platform,
        tokens_used: response.usage.total_tokens
      });
      
      return embedding;
    } catch (error) {
      logger.error('Error generating embedding', {
        creator_id: creator.creator_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Store embedding in Pinecone
   */
  async storeEmbedding(creator, embedding) {
    try {
      await this.index.upsert([{
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
          country: (creator.audience_countries || [])[0] || 'unknown',
          verified: creator.verified || false,
          updated_at: Math.floor(Date.now() / 1000)
        }
      }]);
      
      logger.info(`Stored embedding in Pinecone for ${creator.username}`);
    } catch (error) {
      logger.error('Error storing embedding', {
        creator_id: creator.creator_id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Process single creator (generate + store)
   */
  async processCreator(creator) {
    const embedding = await this.generateEmbedding(creator);
    await this.storeEmbedding(creator, embedding);
    return embedding;
  }

  /**
   * Batch process multiple creators
   */
  async batchProcess(creators, batchSize = 100) {
    logger.info(`Processing ${creators.length} creators in batches of ${batchSize}`);
    
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };
    
    for (let i = 0; i < creators.length; i += batchSize) {
      const batch = creators.slice(i, i + batchSize);
      
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(creators.length / batchSize)}`);
      
      for (const creator of batch) {
        try {
          await this.processCreator(creator);
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            creator_id: creator.creator_id,
            error: error.message
          });
        }
      }
      
      // Rate limiting: Wait 2 seconds between batches
      if (i + batchSize < creators.length) {
        await this.sleep(2000);
      }
    }
    
    logger.info('Batch processing complete', results);
    return results;
  }

  /**
   * Check if embedding needs regeneration
   */
  async shouldRegenerate(creator) {
    try {
      const existing = await this.index.fetch([creator.creator_id]);
      
      if (!existing.records[creator.creator_id]) {
        return true; // No embedding exists
      }
      
      const existingMeta = existing.records[creator.creator_id].metadata;
      
      // Regenerate if bio or niche changed
      if (
        creator.bio !== existingMeta.bio ||
        creator.primary_niche !== existingMeta.primary_niche
      ) {
        return true;
      }
      
      // Regenerate if older than 30 days
      const daysSinceUpdate = (Date.now() / 1000 - existingMeta.updated_at) / 86400;
      if (daysSinceUpdate > 30) {
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Error checking if regeneration needed', {
        creator_id: creator.creator_id,
        error: error.message
      });
      return true; // Regenerate on error to be safe
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = EmbeddingsGenerator;
