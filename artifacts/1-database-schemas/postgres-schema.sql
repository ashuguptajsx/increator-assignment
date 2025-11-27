-- ============================================================================
-- InCreator AI - PostgreSQL Database Schema
-- Scalable Influencer Discovery Platform
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "fuzzystrmatch"; -- For Levenshtein distance

-- ============================================================================
-- 1. CREATORS TABLE (Partitioned by Platform)
-- ============================================================================

CREATE TABLE creators (
    -- Primary identifiers
    creator_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('instagram', 'youtube', 'tiktok', 'twitter')),
    platform_user_id VARCHAR(255) NOT NULL,
    
    -- Profile information
    username VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    bio TEXT,
    profile_image_url TEXT,
    
    -- Metrics
    followers_count BIGINT DEFAULT 0,
    following_count BIGINT DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2), -- Percentage (e.g., 4.50 = 4.5%)
    avg_views BIGINT,
    avg_likes BIGINT,
    avg_comments BIGINT,
    avg_shares BIGINT,
    
    -- Classification (AI-generated)
    primary_niche VARCHAR(100),
    secondary_niches TEXT[], -- Array of additional niches
    content_themes TEXT[], -- Keywords describing content
    content_languages TEXT[], -- e.g., ['en', 'hi', 'es']
    
    -- Audience demographics
    audience_countries TEXT[], -- Top countries by percentage
    audience_age_range VARCHAR(20), -- e.g., '18-24', '25-34'
    audience_gender_split JSONB, -- {"male": 40, "female": 60}
    
    -- Contact & verification
    verified BOOLEAN DEFAULT FALSE,
    is_business BOOLEAN DEFAULT FALSE,
    contact_email VARCHAR(255),
    external_url TEXT,
    
    -- Quality scores
    authenticity_score DECIMAL(3,2), -- 0.00 to 1.00
    follower_quality_score DECIMAL(3,2), -- Detect fake followers
    content_quality_score DECIMAL(3,2), -- Based on engagement patterns
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_scraped_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE, -- False if account deleted/private
    
    -- Multi-tenancy (for future)
    tenant_id UUID, -- NULL for shared data
    
    -- Constraints
    UNIQUE(platform, platform_user_id)
) PARTITION BY LIST (platform);

-- Create partitions for each platform
CREATE TABLE creators_instagram PARTITION OF creators FOR VALUES IN ('instagram');
CREATE TABLE creators_youtube PARTITION OF creators FOR VALUES IN ('youtube');
CREATE TABLE creators_tiktok PARTITION OF creators FOR VALUES IN ('tiktok');
CREATE TABLE creators_twitter PARTITION OF creators FOR VALUES IN ('twitter');

-- Indexes for common query patterns
CREATE INDEX idx_creators_followers ON creators(followers_count DESC);
CREATE INDEX idx_creators_engagement ON creators(engagement_rate DESC);
CREATE INDEX idx_creators_niche ON creators(primary_niche);
CREATE INDEX idx_creators_updated ON creators(updated_at);
CREATE INDEX idx_creators_active ON creators(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_creators_verified ON creators(verified) WHERE verified = TRUE;
CREATE INDEX idx_creators_username_trgm ON creators USING gin(username gin_trgm_ops);
CREATE INDEX idx_creators_bio_trgm ON creators USING gin(bio gin_trgm_ops);

-- Full-text search index
CREATE INDEX idx_creators_bio_fts ON creators USING gin(to_tsvector('english', bio));

-- ============================================================================
-- 2. CREATOR IDENTITIES (Cross-Platform Linking)
-- ============================================================================

CREATE TABLE creator_identities (
    identity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_creator_id UUID REFERENCES creators(creator_id) ON DELETE CASCADE,
    linked_creator_id UUID REFERENCES creators(creator_id) ON DELETE CASCADE,
    
    -- Resolution metadata
    confidence_score DECIMAL(3,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    resolution_method VARCHAR(50) NOT NULL CHECK (resolution_method IN ('email', 'url', 'embedding', 'username', 'manual')),
    
    -- Verification
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID, -- User ID who verified
    verified_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Prevent duplicate links
    UNIQUE(canonical_creator_id, linked_creator_id)
);

CREATE INDEX idx_identity_canonical ON creator_identities(canonical_creator_id);
CREATE INDEX idx_identity_linked ON creator_identities(linked_creator_id);
CREATE INDEX idx_identity_confidence ON creator_identities(confidence_score DESC);

-- ============================================================================
-- 3. CONTENT SAMPLES (Time-Series Data)
-- ============================================================================

CREATE TABLE content_samples (
    sample_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES creators(creator_id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL,
    
    -- Post identifiers
    post_id VARCHAR(255) NOT NULL,
    post_type VARCHAR(50), -- 'image', 'video', 'carousel', 'reel', 'short', 'tweet'
    post_url TEXT,
    
    -- Content
    caption TEXT,
    media_urls TEXT[],
    hashtags TEXT[],
    mentions TEXT[],
    
    -- Metrics (snapshot at scrape time)
    likes_count BIGINT DEFAULT 0,
    comments_count BIGINT DEFAULT 0,
    shares_count BIGINT DEFAULT 0,
    views_count BIGINT DEFAULT 0,
    saves_count BIGINT DEFAULT 0,
    
    -- Timestamps
    posted_at TIMESTAMP NOT NULL,
    scraped_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(platform, post_id)
) PARTITION BY RANGE (posted_at);

-- Create monthly partitions (example for Nov-Dec 2025)
CREATE TABLE content_samples_2025_11 PARTITION OF content_samples
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE content_samples_2025_12 PARTITION OF content_samples
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Indexes
CREATE INDEX idx_content_creator ON content_samples(creator_id, posted_at DESC);
CREATE INDEX idx_content_posted ON content_samples(posted_at DESC);
CREATE INDEX idx_content_hashtags ON content_samples USING gin(hashtags);

-- ============================================================================
-- 4. INGESTION QUEUE (Track Scraping Jobs)
-- ============================================================================

CREATE TABLE ingestion_queue (
    queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID REFERENCES creators(creator_id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL,
    platform_user_id VARCHAR(255) NOT NULL,
    
    -- Priority (higher = more urgent)
    priority INTEGER DEFAULT 0,
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rate_limited')),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Error handling
    last_error TEXT,
    last_error_at TIMESTAMP,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    next_retry_at TIMESTAMP
);

CREATE INDEX idx_queue_status ON ingestion_queue(status, priority DESC);
CREATE INDEX idx_queue_retry ON ingestion_queue(next_retry_at) WHERE status = 'rate_limited';

-- ============================================================================
-- 5. ENRICHMENT JOBS (AI Processing Tracking)
-- ============================================================================

CREATE TABLE enrichment_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES creators(creator_id) ON DELETE CASCADE,
    
    -- Job type
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('embedding', 'classification', 'identity_resolution', 'quality_scoring')),
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    
    -- Results (JSON)
    result JSONB,
    
    -- Cost tracking
    tokens_used INTEGER,
    cost_usd DECIMAL(10,6),
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_enrichment_creator ON enrichment_jobs(creator_id, job_type);
CREATE INDEX idx_enrichment_status ON enrichment_jobs(status, created_at);

-- ============================================================================
-- 6. SEARCH ANALYTICS (Track User Searches)
-- ============================================================================

CREATE TABLE search_analytics (
    search_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User context
    user_id UUID, -- NULL for anonymous
    tenant_id UUID,
    
    -- Query
    query_text TEXT,
    filters JSONB, -- {"platform": ["instagram"], "followers_min": 100000}
    
    -- Results
    results_count INTEGER,
    top_result_ids UUID[], -- Array of creator_ids
    
    -- Performance
    latency_ms INTEGER,
    cache_hit BOOLEAN DEFAULT FALSE,
    
    -- User interaction
    clicked_result_ids UUID[], -- Which results user clicked
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_search_user ON search_analytics(user_id, created_at DESC);
CREATE INDEX idx_search_created ON search_analytics(created_at DESC);

-- ============================================================================
-- 7. AUDIT LOG (Compliance & Debugging)
-- ============================================================================

CREATE TABLE audit_log (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- What happened
    event_type VARCHAR(50) NOT NULL, -- 'creator_created', 'creator_updated', 'search_performed'
    entity_type VARCHAR(50), -- 'creator', 'identity', 'search'
    entity_id UUID,
    
    -- Who did it
    user_id UUID,
    tenant_id UUID,
    ip_address INET,
    
    -- Details
    changes JSONB, -- Before/after for updates
    
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE audit_log_2025_11 PARTITION OF audit_log
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);

-- ============================================================================
-- 8. MATERIALIZED VIEWS (Pre-computed Analytics)
-- ============================================================================

-- Top creators by niche
CREATE MATERIALIZED VIEW top_creators_by_niche AS
SELECT 
    primary_niche,
    platform,
    COUNT(*) as creator_count,
    AVG(followers_count) as avg_followers,
    AVG(engagement_rate) as avg_engagement,
    ARRAY_AGG(creator_id ORDER BY followers_count DESC LIMIT 10) as top_creator_ids
FROM creators
WHERE is_active = TRUE
GROUP BY primary_niche, platform;

CREATE UNIQUE INDEX idx_top_niche ON top_creators_by_niche(primary_niche, platform);

-- Refresh daily
-- REFRESH MATERIALIZED VIEW CONCURRENTLY top_creators_by_niche;

-- ============================================================================
-- 9. FUNCTIONS & TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_creators_updated_at
    BEFORE UPDATE ON creators
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Calculate engagement rate automatically
CREATE OR REPLACE FUNCTION calculate_engagement_rate()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.followers_count > 0 THEN
        NEW.engagement_rate = (
            (COALESCE(NEW.avg_likes, 0) + COALESCE(NEW.avg_comments, 0)) 
            / NEW.followers_count::DECIMAL
        ) * 100;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_creators_engagement
    BEFORE INSERT OR UPDATE ON creators
    FOR EACH ROW
    EXECUTE FUNCTION calculate_engagement_rate();

-- ============================================================================
-- 10. ROW-LEVEL SECURITY (Multi-Tenancy)
-- ============================================================================

-- Enable RLS on creators table
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their tenant's data
CREATE POLICY tenant_isolation ON creators
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant', TRUE)::UUID);

-- Policy: Admins can see everything
CREATE POLICY admin_access ON creators
    USING (current_setting('app.user_role', TRUE) = 'admin');

-- ============================================================================
-- 11. SAMPLE DATA (For Testing)
-- ============================================================================

-- Insert sample creators
INSERT INTO creators (platform, platform_user_id, username, display_name, bio, followers_count, following_count, posts_count, primary_niche, verified) VALUES
('instagram', '123456', 'fitness_guru_india', 'Fitness Guru', 'Personal trainer | Nutrition tips | DM for collabs', 500000, 1200, 850, 'fitness', TRUE),
('instagram', '789012', 'travel_wanderer', 'Travel Wanderer', 'Exploring the world one city at a time 🌍', 250000, 800, 1200, 'travel', FALSE),
('youtube', 'UC_abc123', 'TechReviewsHD', 'Tech Reviews HD', 'Honest tech reviews and unboxings', 1200000, 0, 450, 'technology', TRUE),
('tiktok', 'tt_xyz789', 'cooking_with_love', 'Cooking With Love', 'Easy recipes for busy people 🍳', 3000000, 500, 2000, 'food', TRUE);

-- ============================================================================
-- 12. USEFUL QUERIES
-- ============================================================================

-- Find creators by niche with high engagement
-- SELECT * FROM creators 
-- WHERE primary_niche = 'fitness' 
--   AND engagement_rate > 3.0 
--   AND followers_count > 100000
-- ORDER BY engagement_rate DESC
-- LIMIT 20;

-- Search creators by bio (full-text)
-- SELECT *, ts_rank(to_tsvector('english', bio), to_tsquery('fitness & nutrition')) as rank
-- FROM creators
-- WHERE to_tsvector('english', bio) @@ to_tsquery('fitness & nutrition')
-- ORDER BY rank DESC
-- LIMIT 10;

-- Find potential identity matches (same email)
-- SELECT c1.username as user1, c1.platform as platform1, 
--        c2.username as user2, c2.platform as platform2,
--        c1.contact_email
-- FROM creators c1
-- JOIN creators c2 ON c1.contact_email = c2.contact_email
-- WHERE c1.creator_id < c2.creator_id
--   AND c1.contact_email IS NOT NULL;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
