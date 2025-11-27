/**
 * Instagram API Client with Rate Limiting
 * 
 * Handles fetching creator profiles from Instagram Graph API
 * with intelligent rate limiting and retry logic.
 */

const axios = require('axios');
const Bottleneck = require('bottleneck');

class InstagramClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.baseURL = 'https://graph.instagram.com/v18.0';
    
    // Rate limiter: 200 requests per hour
    this.limiter = new Bottleneck({
      reservoir: 200,
      reservoirRefreshAmount: 200,
      reservoirRefreshInterval: 60 * 60 * 1000, // 1 hour
      maxConcurrent: 5,
      minTime: 100 // Minimum 100ms between requests
    });
  }

  /**
   * Fetch user profile by username
   */
  async getUserProfile(username) {
    return this.limiter.schedule(() => this._fetchUserProfile(username));
  }

  async _fetchUserProfile(username) {
    try {
      // Step 1: Get user ID from username
      const userIdResponse = await axios.get(`${this.baseURL}/ig_user`, {
        params: {
          username: username,
          access_token: this.accessToken
        },
        timeout: 10000
      });

      const userId = userIdResponse.data.id;

      // Step 2: Get detailed profile
      const profileResponse = await axios.get(`${this.baseURL}/${userId}`, {
        params: {
          fields: 'id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count,is_verified,is_business_account,business_email,website',
          access_token: this.accessToken
        },
        timeout: 10000
      });

      // Step 3: Get recent media for engagement calculation
      const mediaResponse = await axios.get(`${this.baseURL}/${userId}/media`, {
        params: {
          fields: 'id,caption,like_count,comments_count,timestamp,media_type',
          limit: 25,
          access_token: this.accessToken
        },
        timeout: 10000
      });

      return this._transformProfile(profileResponse.data, mediaResponse.data.data);
    } catch (error) {
      if (error.response?.status === 429) {
        throw new Error('RATE_LIMITED');
      } else if (error.response?.status === 404) {
        throw new Error('USER_NOT_FOUND');
      } else {
        throw error;
      }
    }
  }

  /**
   * Transform Instagram API response to our schema
   */
  _transformProfile(profile, media) {
    // Calculate engagement rate
    const totalEngagement = media.reduce((sum, post) => {
      return sum + (post.like_count || 0) + (post.comments_count || 0);
    }, 0);
    
    const avgEngagement = media.length > 0 ? totalEngagement / media.length : 0;
    const engagementRate = profile.followers_count > 0 
      ? (avgEngagement / profile.followers_count) * 100 
      : 0;

    return {
      platform: 'instagram',
      platform_user_id: profile.id,
      username: profile.username,
      display_name: profile.name,
      bio: profile.biography,
      profile_image_url: profile.profile_picture_url,
      followers_count: profile.followers_count,
      following_count: profile.follows_count,
      posts_count: profile.media_count,
      engagement_rate: parseFloat(engagementRate.toFixed(2)),
      avg_likes: Math.round(media.reduce((sum, p) => sum + (p.like_count || 0), 0) / media.length),
      avg_comments: Math.round(media.reduce((sum, p) => sum + (p.comments_count || 0), 0) / media.length),
      verified: profile.is_verified || false,
      is_business: profile.is_business_account || false,
      contact_email: profile.business_email || null,
      external_url: profile.website || null,
      scraped_at: new Date().toISOString(),
      raw_data: { profile, media }
    };
  }

  /**
   * Batch fetch multiple users
   */
  async batchGetUsers(usernames) {
    const results = [];
    
    for (const username of usernames) {
      try {
        const profile = await this.getUserProfile(username);
        results.push({ success: true, data: profile });
      } catch (error) {
        results.push({ 
          success: false, 
          username, 
          error: error.message 
        });
      }
    }
    
    return results;
  }
}

module.exports = InstagramClient;
