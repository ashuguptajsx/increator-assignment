# Trade-offs and Scaling Roadmap
## InCreator AI - Influencer Discovery Platform

**Version**: 1.0  
**Date**: November 27, 2025

---

## Table of Contents
1. [MVP Strategy (Month 1-3)](#mvp-strategy-month-1-3)
2. [Post-PMF Scaling (Month 4-12)](#post-pmf-scaling-month-4-12)
3. [Key Trade-offs](#key-trade-offs)
4. [12-Month Evolution Roadmap](#12-month-evolution-roadmap)

---

## 1. MVP Strategy (Month 1-3)

### **Philosophy: Ship Fast, Learn Faster**

The MVP focuses on **proving value** with minimal complexity. We prioritize:
- ✅ **Single platform** (Instagram only)
- ✅ **Manual workflows** where automation isn't critical
- ✅ **Simple tech stack** (avoid over-engineering)
- ✅ **Small dataset** (1M creators to start)

---

### **1.1 What Ships in MVP**

| Component | MVP Approach | Complexity | Rationale |
|-----------|--------------|------------|-----------|
| **Data Ingestion** | Batch processing (daily cron jobs) | Low | No need for real-time updates initially |
| **Platform Coverage** | Instagram only | Low | 80% of influencer marketing happens here |
| **Storage** | Single PostgreSQL instance (RDS) | Low | Simpler to manage, sufficient for 1M creators |
| **Search** | PostgreSQL full-text search | Low | Good enough for keyword matching |
| **AI Enrichment** | Manual tagging + basic keyword extraction | Low | Avoid AI costs until we validate demand |
| **Identity Resolution** | None (single platform) | N/A | Not needed for MVP |
| **API** | Simple REST API with basic auth | Low | Focus on functionality over security |
| **Monitoring** | CloudWatch basic metrics | Low | Logs + uptime monitoring only |

### **1.2 MVP Architecture Diagram**

```
┌─────────────────────────────────────────────────────┐
│                    MVP ARCHITECTURE                  │
└─────────────────────────────────────────────────────┘

Instagram API
     │
     ├─> Cron Job (runs daily)
     │      │
     │      └─> Fetch 10K creators/day
     │
     ├─> Store in PostgreSQL (RDS db.t3.large)
     │      │
     │      └─> Tables: creators, content_samples
     │
     ├─> Simple Search API (Express.js)
     │      │
     │      └─> WHERE bio LIKE '%keyword%'
     │
     └─> Frontend (React) → Display results
```

### **1.3 MVP Tech Stack**

| Layer | Technology | Why? |
|-------|------------|------|
| **Backend** | Node.js + Express | Fast development, team expertise |
| **Database** | PostgreSQL (RDS) | Familiar, handles 1M rows easily |
| **Hosting** | AWS ECS Fargate | Serverless, no infra management |
| **Storage** | S3 (profile images) | Cheap, scalable |
| **Search** | PostgreSQL LIKE queries | No additional services needed |
| **Monitoring** | CloudWatch | Built-in with AWS |

### **1.4 MVP Metrics to Validate**

Before scaling, we need to prove:

1. **User Engagement**
   - Do brands actually search for creators?
   - What filters do they use most?
   - Average searches per session?

2. **Data Quality**
   - Are creator profiles accurate?
   - How often do users report incorrect data?
   - What fields are most important?

3. **Search Relevance**
   - Do keyword searches return useful results?
   - What's the click-through rate on search results?
   - Do we need semantic search?

4. **Business Viability**
   - Will brands pay for this?
   - What's the willingness to pay?
   - Which features drive conversions?

### **1.5 MVP Cost Estimate**

| Service | Cost/Month |
|---------|------------|
| RDS (db.t3.large) | $120 |
| ECS Fargate (2 tasks) | $60 |
| S3 (50GB) | $2 |
| CloudWatch | $10 |
| **Total** | **$192/month** |

**Burn rate**: <$200/month while validating PMF 🎯

---

## 2. Post-PMF Scaling (Month 4-12)

### **2.1 What Changes After PMF**

Once we validate demand, we aggressively scale:

| Component | Post-PMF Approach | Why Now? |
|-----------|-------------------|----------|
| **Platform Coverage** | Add YouTube, TikTok, Twitter | Users demand multi-platform |
| **Storage** | Add DynamoDB + Pinecone | PostgreSQL hits limits at 10M+ |
| **Search** | Vector embeddings + hybrid search | Keyword search isn't good enough |
| **AI Enrichment** | Automated with OpenAI | Manual tagging doesn't scale |
| **Identity Resolution** | Cross-platform matching | Critical for multi-platform |
| **Ingestion** | Real-time with SQS + Lambda | Users want fresh data |
| **API** | GraphQL + advanced auth | Support complex queries |
| **Monitoring** | DataDog + custom dashboards | Need deep observability |

### **2.2 Scaling Triggers**

We scale when we hit these thresholds:

| Metric | Threshold | Action |
|--------|-----------|--------|
| **Creators in DB** | >5M | Add read replicas, consider sharding |
| **Search QPS** | >100 | Add Redis cache, CDN |
| **API Latency (p95)** | >1s | Optimize queries, add indexes |
| **Monthly Cost** | >$5K | Review and optimize spend |
| **User Complaints** | >5% | Investigate data quality issues |

### **2.3 Post-PMF Architecture**

```
┌─────────────────────────────────────────────────────────────┐
│               POST-PMF ARCHITECTURE (50M+ Creators)          │
└─────────────────────────────────────────────────────────────┘

Multi-Platform APIs (Instagram, YouTube, TikTok, Twitter)
     │
     ├─> SQS Queues (per platform)
     │      │
     │      └─> ECS Workers (auto-scaling)
     │             │
     │             ├─> Rate Limiters (Bottleneck)
     │             └─> Write to DynamoDB (raw data)
     │
     ├─> DynamoDB Streams → Lambda
     │      │
     │      └─> Parse & Validate → PostgreSQL (Aurora)
     │
     ├─> Enrichment Pipeline
     │      │
     │      ├─> OpenAI Embeddings → Pinecone
     │      ├─> LLM Classification → PostgreSQL
     │      └─> Identity Resolution → Link creators
     │
     ├─> Search API (GraphQL)
     │      │
     │      ├─> Redis Cache (hot queries)
     │      ├─> Pinecone (vector search)
     │      └─> PostgreSQL (filters + ranking)
     │
     └─> CloudFront CDN → Frontend
```

---

## 3. Key Trade-offs

### **3.1 Batch vs. Real-Time Ingestion**

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Batch (MVP)** | Simple, cheap, easier to debug | Stale data (24hr lag) | ✅ MVP |
| **Real-Time (Post-PMF)** | Fresh data, better UX | Complex, expensive, harder to debug | ✅ Post-PMF |

**Trade-off**: Accept stale data in MVP to ship faster. Add real-time later when users demand it.

---

### **3.2 PostgreSQL vs. NoSQL**

| Database | Pros | Cons | Decision |
|----------|------|------|----------|
| **PostgreSQL** | ACID, complex queries, familiar | Scaling limits at 50M+ rows | ✅ MVP |
| **DynamoDB** | Unlimited scale, fast writes | No complex queries, eventual consistency | ✅ Post-PMF (hybrid) |

**Trade-off**: Start with PostgreSQL for simplicity. Add DynamoDB for write-heavy workloads post-PMF.

---

### **3.3 Keyword Search vs. Vector Search**

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Keyword (SQL LIKE)** | Simple, no extra services, free | Poor relevance, misses synonyms | ✅ MVP |
| **Vector (Embeddings)** | Semantic understanding, better results | Costs $70-$9K/month, complex | ✅ Post-PMF |

**Trade-off**: Validate that users need better search before investing in embeddings.

---

### **3.4 Manual vs. Automated AI Enrichment**

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Manual Tagging** | Free, accurate (human review) | Doesn't scale, slow | ✅ MVP |
| **Automated (LLMs)** | Scales infinitely, fast | Costs $0.0003/creator, 92% accuracy | ✅ Post-PMF |

**Trade-off**: Use humans to tag 10K creators in MVP. Learn what tags matter, then automate.

---

### **3.5 Single-Tenant vs. Multi-Tenant**

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Single-Tenant (MVP)** | Simple, no isolation needed | Can't sell to enterprises | ✅ MVP |
| **Multi-Tenant** | Scalable, enterprise-ready | Complex (row-level security, quotas) | ✅ Post-PMF |

**Trade-off**: Build for single customer (ourselves) in MVP. Add multi-tenancy when we have paying customers.

---

### **3.6 Monolith vs. Microservices**

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Monolith** | Fast development, easy debugging | Harder to scale teams | ✅ MVP |
| **Microservices** | Independent scaling, team autonomy | Operational complexity | ✅ Post-PMF (if team >10) |

**Trade-off**: Stay monolith until we have 10+ engineers. Premature microservices slow us down.

---

## 4. 12-Month Evolution Roadmap

### **Month 1-3: MVP Launch** 🚀

**Goal**: Validate product-market fit with 1M Instagram creators

**Deliverables**:
- ✅ Instagram ingestion pipeline (10K creators/day)
- ✅ PostgreSQL database with basic schema
- ✅ Simple search API (keyword matching)
- ✅ Basic web UI for searching creators
- ✅ Manual niche tagging for top 10K creators

**Team**: 2 engineers (1 backend, 1 full-stack)

**Metrics to Hit**:
- 1M creators in database
- 100 active users (brands/agencies)
- 1,000 searches/week
- <$200/month infrastructure cost

---

### **Month 4-6: Multi-Platform Expansion** 🌍

**Goal**: Add YouTube and TikTok, reach 10M creators

**Deliverables**:
- ✅ YouTube and TikTok ingestion
- ✅ Identity resolution (basic email/URL matching)
- ✅ Upgrade to Aurora PostgreSQL with read replicas
- ✅ Add Redis caching layer
- ✅ Improve search with filters (followers, engagement, location)

**Team**: 4 engineers (2 backend, 1 data, 1 frontend)

**Metrics to Hit**:
- 10M creators across 3 platforms
- 500 active users
- 10,000 searches/week
- <$1,000/month infrastructure cost

---

### **Month 7-9: AI-Powered Search** 🤖

**Goal**: Launch semantic search with embeddings

**Deliverables**:
- ✅ Integrate OpenAI embeddings
- ✅ Set up Pinecone vector database
- ✅ Hybrid search (vector + keyword)
- ✅ Automated niche classification with GPT-4
- ✅ Advanced ranking algorithm

**Team**: 6 engineers (3 backend, 1 ML, 1 data, 1 frontend)

**Metrics to Hit**:
- 25M creators with embeddings
- 2,000 active users
- 50,000 searches/week
- Search relevance score >80%
- <$5,000/month infrastructure cost

---

### **Month 10-12: Enterprise Scale** 🏢

**Goal**: Scale to 50M creators, add enterprise features

**Deliverables**:
- ✅ Add Twitter/X platform
- ✅ Multi-tenancy with row-level security
- ✅ Advanced identity resolution (embedding-based)
- ✅ Real-time ingestion with SQS + Lambda
- ✅ GraphQL API for complex queries
- ✅ DataDog monitoring and alerting
- ✅ SOC 2 compliance prep

**Team**: 10 engineers (4 backend, 2 ML, 2 data, 2 frontend)

**Metrics to Hit**:
- 50M creators across 4 platforms
- 10,000 active users
- 500,000 searches/week
- 10+ enterprise customers
- <$10,000/month infrastructure cost

---

## 5. Decision Framework

### **When to Add Complexity**

Use this framework to decide when to scale:

```
Should we add [FEATURE]?

1. Is it blocking revenue? 
   → YES: High priority
   → NO: Continue...

2. Are users complaining?
   → YES (>10% of users): High priority
   → NO: Continue...

3. Is current solution breaking?
   → YES (downtime/errors): High priority
   → NO: Continue...

4. Will it 10x our capability?
   → YES: Medium priority
   → NO: Low priority (defer)
```

**Examples**:

| Feature | Blocking Revenue? | Users Complaining? | Breaking? | 10x Impact? | Priority |
|---------|-------------------|-------------------|-----------|-------------|----------|
| Vector search | No | Yes (15%) | No | Yes | **High** |
| Twitter ingestion | Yes | Yes (30%) | No | Yes | **High** |
| GraphQL API | No | No | No | No | **Low** |
| Real-time updates | No | Yes (5%) | No | No | **Low** |
| Microservices | No | No | No | No | **Defer** |

---

## 6. Cost Evolution

### **Cost Projections Over 12 Months**

| Month | Creators | Monthly Cost | Cost/Creator/Year | Team Size |
|-------|----------|--------------|-------------------|-----------|
| **1-3** | 1M | $200 | $2.40 | 2 |
| **4-6** | 10M | $1,000 | $1.20 | 4 |
| **7-9** | 25M | $5,000 | $2.40 | 6 |
| **10-12** | 50M | $10,000 | $2.40 | 10 |

**Key Insight**: Cost per creator **decreases** as we scale due to:
- Reserved instance discounts
- Batch processing efficiency
- Shared infrastructure overhead

---

## 7. Risk Mitigation

### **7.1 Technical Risks**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **API rate limits block ingestion** | High | High | Multi-account rotation, exponential backoff |
| **PostgreSQL can't scale to 50M** | Medium | High | Plan for sharding at 25M, test early |
| **Embedding costs spiral** | Medium | Medium | Cache embeddings, only regenerate on changes |
| **Search latency >2s** | Medium | High | Add Redis cache, optimize queries, CDN |

### **7.2 Business Risks**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **No PMF (users don't search)** | Medium | Critical | MVP validates demand before scaling |
| **Competitors launch first** | High | Medium | Ship MVP in 3 months, iterate fast |
| **Data quality issues** | High | High | Manual review for top creators, user reporting |
| **Platform APIs shut down** | Low | Critical | Diversify platforms, backup data to S3 |

---

## 8. Success Criteria

### **MVP Success (Month 3)**
- ✅ 100 active users
- ✅ 1,000 searches/week
- ✅ 1M creators in database
- ✅ <$200/month cost
- ✅ 5+ brands willing to pay

### **Post-PMF Success (Month 12)**
- ✅ 10,000 active users
- ✅ 500,000 searches/week
- ✅ 50M creators across 4 platforms
- ✅ $100K ARR
- ✅ <$10K/month infrastructure cost
- ✅ Search relevance >80%

---

## Conclusion

This roadmap balances **speed** (ship MVP in 3 months) with **scalability** (reach 50M creators in 12 months).

**Core Philosophy**:
1. **Start simple**: Prove value before adding complexity
2. **Measure everything**: Data-driven decisions on when to scale
3. **Optimize for learning**: Fast iteration beats perfect architecture
4. **Cost-conscious**: Every dollar spent must drive revenue or learning

**Next Steps**: Build MVP, validate PMF, then scale aggressively. 🚀
