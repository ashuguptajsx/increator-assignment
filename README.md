# InCreator AI - Scalable Influencer Discovery System

## 🎯 Assignment Overview

This repository contains the architectural design and technical implementation for a **multi-platform influencer discovery system** capable of scaling to **250M+ creators** across Instagram, YouTube, TikTok, and X (Twitter).

**Candidate**: [Your Name]  
**Date**: November 27, 2025  
**Role**: Founding Engineer - InCreator AI

---

## 📁 Repository Structure

```
increator-assignment/
├── docs/
│   ├── architecture-diagram.png          # High-level system architecture
│   ├── design-writeup.md                 # Comprehensive design document (2-4 pages)
│   └── tradeoffs-and-roadmap.md          # MVP vs. future scaling decisions
│
├── artifacts/
│   ├── 1-database-schemas/
│   │   ├── postgres-schema.sql           # Relational data model
│   │   ├── dynamodb-schema.json          # NoSQL schema for high-throughput writes
│   │   └── vector-db-config.md           # Pinecone/OpenSearch configuration
│   │
│   ├── 2-api-spec/
│   │   └── openapi.yaml                  # REST API specification
│   │
│   ├── 3-embeddings-prototype/
│   │   ├── ranking-prototype.js          # Node.js embeddings demo
│   │   └── sample-results.json           # Example search results
│   │
│   ├── 4-airflow-dag/
│   │   └── influencer_ingestion_dag.py   # Orchestration pipeline
│   │
│   └── 5-cost-model/
│       └── cost-analysis.md              # Cost breakdown for 1M, 50M, 250M creators
│
├── src/
│   ├── ingestion/
│   │   ├── orchestrator.js               # Main ingestion coordinator
│   │   ├── instagram-client.js           # Instagram API client
│   │   ├── youtube-client.js             # YouTube API client
│   │   ├── tiktok-client.js              # TikTok API client
│   │   └── rate-limiter.js               # Rate limiting strategy
│   │
│   ├── enrichment/
│   │   ├── embeddings-generator.js       # Generate vector embeddings
│   │   ├── identity-resolver.js          # Cross-platform matching
│   │   └── llm-classifier.js             # AI-based niche classification
│   │
│   ├── api/
│   │   ├── server.js                     # Express API server
│   │   ├── routes/
│   │   │   ├── search.js                 # Search endpoints
│   │   │   └── creators.js               # Creator CRUD endpoints
│   │   └── middleware/
│   │       └── auth.js                   # Authentication middleware
│   │
│   └── utils/
│       ├── logger.js                     # Winston logging
│       └── db-clients.js                 # Database connection helpers
│
├── package.json
├── .env.example
└── README.md
```

---

## 🏗️ Architecture Highlights

### **Core Components**

1. **Multi-Platform Ingestion**
   - Parallel API clients for Instagram, YouTube, TikTok, X
   - Intelligent rate limiting (per-platform quotas)
   - SQS-based queue for retry logic and backfills

2. **Data Storage Layer**
   - **PostgreSQL/Aurora**: Structured creator profiles, metrics, relationships
   - **DynamoDB**: High-throughput raw API responses
   - **S3**: Media storage (profile images, content samples)
   - **Pinecone/OpenSearch**: Vector embeddings for semantic search

3. **AI Enrichment Pipeline**
   - OpenAI embeddings for creator bios and content
   - LLM-based niche classification and scoring
   - Cross-platform identity resolution using embeddings

4. **Search & Ranking**
   - Hybrid search (vector similarity + keyword filters)
   - Multi-factor ranking (relevance, engagement, authenticity)
   - Real-time filtering by platform, location, followers, etc.

5. **API Layer**
   - RESTful API with OpenAPI spec
   - Rate limiting and authentication
   - Multi-tenancy support for brand accounts

---

## 🚀 Quick Start

### **Prerequisites**
- Node.js 18+
- PostgreSQL 14+
- Redis (for Bull queue)
- AWS Account (S3, DynamoDB, SQS)
- OpenAI API Key
- Pinecone API Key

### **Installation**

```bash
# Clone repository
git clone <repo-url>
cd increator-assignment

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run database migrations
psql -U postgres -d increator -f artifacts/1-database-schemas/postgres-schema.sql

# Start API server
npm run dev
```

### **Running Components**

```bash
# Start ingestion pipeline
npm run ingest

# Generate embeddings for existing creators
npm run enrich

# Start API server
npm start
```

---

## 📊 Technical Artifacts

### **1. Database Schemas** ✅
- PostgreSQL schema with partitioning strategy
- DynamoDB schema for write-heavy workloads
- Vector database configuration

### **2. API Specification** ✅
- OpenAPI 3.0 spec with all endpoints
- Request/response examples
- Authentication flows

### **3. Embeddings Prototype** ✅
- Working Node.js implementation
- Semantic search demo
- Ranking algorithm with sample data

### **4. Airflow DAG** ✅
- Python DAG for daily ingestion
- Retry logic and error handling
- Backfill support

### **5. Cost Model** ✅
- Detailed breakdown for 1M, 50M, 250M creators
- AWS service costs
- API and AI costs

---

## 🎯 Key Design Decisions

### **What Ships in MVP (Month 1-3)**
- Single-platform ingestion (Instagram only)
- Basic PostgreSQL storage
- Simple keyword search
- Manual enrichment workflows

### **Post-PMF Scaling (Month 4-12)**
- Multi-platform ingestion with identity resolution
- Vector search with embeddings
- Automated AI enrichment
- Real-time updates via webhooks

### **Trade-offs**
- **Simplicity over perfection**: Start with batch processing, add streaming later
- **Cost optimization**: Use DynamoDB on-demand pricing initially
- **AI pragmatism**: Use pre-trained models before fine-tuning

See `docs/tradeoffs-and-roadmap.md` for detailed analysis.

---

## 📈 Scaling Strategy

| Scale | Creators | Strategy |
|-------|----------|----------|
| **1M** | 1M | Single PostgreSQL instance, simple API |
| **50M** | 50M | Read replicas, DynamoDB for writes, caching layer |
| **250M** | 250M | Sharded PostgreSQL, S3 data lake, CDN, vector DB |

---

## 🔐 Security & Multi-Tenancy

- **Authentication**: JWT-based API authentication
- **Authorization**: Row-level security in PostgreSQL
- **Data Isolation**: Tenant-specific S3 prefixes
- **Rate Limiting**: Per-tenant API quotas
- **Encryption**: At-rest (S3, RDS) and in-transit (TLS)

---

## 📚 Documentation

- **[Design Write-up](docs/design-writeup.md)**: Comprehensive architectural document
- **[Trade-offs & Roadmap](docs/tradeoffs-and-roadmap.md)**: MVP vs. scaling decisions
- **[Architecture Diagram](docs/architecture-diagram.png)**: Visual system overview

---

## 🛠️ Technologies Used

**Backend**: Node.js, Express.js, TypeScript  
**Databases**: PostgreSQL, DynamoDB, Pinecone  
**AI/ML**: OpenAI API (embeddings, GPT-4), LangChain  
**AWS**: S3, RDS Aurora, DynamoDB, SQS, Lambda, ECS  
**Orchestration**: Apache Airflow  
**Monitoring**: CloudWatch, DataDog  

---

## 📧 Contact

For questions about this submission, please reach out to [your-email@example.com]

---

## 📄 License

MIT License - This is a technical assignment submission.
