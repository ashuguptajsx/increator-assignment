"""
InCreator AI - Influencer Ingestion DAG
========================================

This Airflow DAG orchestrates the daily ingestion of creator profiles from
Instagram, YouTube, TikTok, and Twitter.

Schedule: Daily at 2 AM UTC
Retries: 3 attempts with exponential backoff
SLA: 6 hours

DAG Flow:
1. Fetch creator IDs to scrape (prioritized by tier)
2. Distribute to platform-specific SQS queues
3. Monitor ingestion progress
4. Trigger enrichment pipeline
5. Update search indexes
6. Send completion notification
"""

from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.bash import BashOperator
from airflow.providers.amazon.aws.operators.sqs import SqsPublishOperator
from airflow.providers.amazon.aws.sensors.sqs import SqsSensor
from airflow.providers.postgres.operators.postgres import PostgresOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.utils.task_group import TaskGroup
from airflow.models import Variable
import json
import logging

# ==================== CONFIGURATION ====================

DEFAULT_ARGS = {
    'owner': 'increator-data-team',
    'depends_on_past': False,
    'email': ['alerts@increator.ai'],
    'email_on_failure': True,
    'email_on_retry': False,
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
    'retry_exponential_backoff': True,
    'max_retry_delay': timedelta(minutes=30),
    'sla': timedelta(hours=6)
}

# Platform-specific configurations
PLATFORM_CONFIGS = {
    'instagram': {
        'queue_url': Variable.get('INSTAGRAM_SQS_QUEUE_URL'),
        'batch_size': 1000,
        'priority_weight': 10
    },
    'youtube': {
        'queue_url': Variable.get('YOUTUBE_SQS_QUEUE_URL'),
        'batch_size': 2000,
        'priority_weight': 8
    },
    'tiktok': {
        'queue_url': Variable.get('TIKTOK_SQS_QUEUE_URL'),
        'batch_size': 500,
        'priority_weight': 7
    },
    'twitter': {
        'queue_url': Variable.get('TWITTER_SQS_QUEUE_URL'),
        'batch_size': 1500,
        'priority_weight': 6
    }
}

# ==================== DAG DEFINITION ====================

dag = DAG(
    'influencer_ingestion_daily',
    default_args=DEFAULT_ARGS,
    description='Daily ingestion of influencer profiles from all platforms',
    schedule_interval='0 2 * * *',  # 2 AM UTC daily
    start_date=datetime(2025, 1, 1),
    catchup=False,
    max_active_runs=1,
    tags=['ingestion', 'production', 'daily']
)

# ==================== HELPER FUNCTIONS ====================

def fetch_creators_to_scrape(platform, batch_size, **context):
    """
    Fetch creator IDs that need to be scraped based on priority tiers.
    
    Priority:
    - Mega (>1M followers): Every 6 hours
    - Macro (100K-1M): Daily
    - Micro (10K-100K): Weekly
    - Nano (<10K): Monthly
    """
    logging.info(f"Fetching creators to scrape for {platform}")
    
    postgres_hook = PostgresHook(postgres_conn_id='increator_postgres')
    
    query = """
        SELECT creator_id, platform, platform_user_id, username, followers_count
        FROM creators
        WHERE platform = %(platform)s
          AND is_active = TRUE
          AND (
              (followers_count > 1000000 AND last_scraped_at < NOW() - INTERVAL '6 hours')
              OR (followers_count BETWEEN 100000 AND 1000000 AND last_scraped_at < NOW() - INTERVAL '1 day')
              OR (followers_count BETWEEN 10000 AND 100000 AND last_scraped_at < NOW() - INTERVAL '7 days')
              OR (followers_count < 10000 AND last_scraped_at < NOW() - INTERVAL '30 days')
              OR last_scraped_at IS NULL
          )
        ORDER BY 
            CASE 
                WHEN followers_count > 1000000 THEN 1
                WHEN followers_count > 100000 THEN 2
                WHEN followers_count > 10000 THEN 3
                ELSE 4
            END,
            followers_count DESC
        LIMIT %(batch_size)s
    """
    
    creators = postgres_hook.get_records(
        query,
        parameters={'platform': platform, 'batch_size': batch_size}
    )
    
    logging.info(f"Found {len(creators)} creators to scrape for {platform}")
    
    # Push to XCom for next task
    context['task_instance'].xcom_push(
        key=f'{platform}_creators',
        value=[{
            'creator_id': str(c[0]),
            'platform': c[1],
            'platform_user_id': c[2],
            'username': c[3],
            'followers_count': c[4]
        } for c in creators]
    )
    
    return len(creators)


def publish_to_sqs(platform, **context):
    """
    Publish creator IDs to platform-specific SQS queue.
    """
    creators = context['task_instance'].xcom_pull(
        task_ids=f'fetch_{platform}_creators',
        key=f'{platform}_creators'
    )
    
    if not creators:
        logging.info(f"No creators to publish for {platform}")
        return 0
    
    # In production, this would use SqsPublishOperator
    # For demo, we'll log the action
    logging.info(f"Publishing {len(creators)} creators to {platform} SQS queue")
    
    # Batch messages (SQS supports up to 10 messages per batch)
    batch_size = 10
    batches = [creators[i:i + batch_size] for i in range(0, len(creators), batch_size)]
    
    for batch in batches:
        messages = [
            {
                'Id': str(idx),
                'MessageBody': json.dumps(creator),
                'MessageAttributes': {
                    'platform': {'StringValue': platform, 'DataType': 'String'},
                    'priority': {
                        'StringValue': str(get_priority(creator['followers_count'])),
                        'DataType': 'Number'
                    }
                }
            }
            for idx, creator in enumerate(batch)
        ]
        
        # SQS publish would happen here
        logging.info(f"Published batch of {len(messages)} messages")
    
    return len(creators)


def get_priority(followers_count):
    """Calculate priority score based on follower count."""
    if followers_count > 1000000:
        return 10
    elif followers_count > 100000:
        return 7
    elif followers_count > 10000:
        return 5
    else:
        return 3


def monitor_ingestion_progress(platform, **context):
    """
    Monitor ingestion progress by checking ingestion_queue table.
    """
    postgres_hook = PostgresHook(postgres_conn_id='increator_postgres')
    
    query = """
        SELECT 
            status,
            COUNT(*) as count
        FROM ingestion_queue
        WHERE platform = %(platform)s
          AND created_at > NOW() - INTERVAL '24 hours'
        GROUP BY status
    """
    
    results = postgres_hook.get_records(query, parameters={'platform': platform})
    
    status_counts = {row[0]: row[1] for row in results}
    
    logging.info(f"{platform} ingestion status: {status_counts}")
    
    # Check for high failure rate
    total = sum(status_counts.values())
    failed = status_counts.get('failed', 0)
    
    if total > 0 and (failed / total) > 0.1:  # >10% failure rate
        logging.warning(f"High failure rate for {platform}: {failed}/{total}")
        # In production, send alert
    
    return status_counts


def trigger_enrichment_pipeline(**context):
    """
    Trigger AI enrichment pipeline for newly ingested creators.
    """
    postgres_hook = PostgresHook(postgres_conn_id='increator_postgres')
    
    # Find creators that need enrichment
    query = """
        INSERT INTO enrichment_jobs (creator_id, job_type, status)
        SELECT 
            c.creator_id,
            'embedding' as job_type,
            'pending' as status
        FROM creators c
        LEFT JOIN enrichment_jobs ej 
            ON c.creator_id = ej.creator_id 
            AND ej.job_type = 'embedding'
            AND ej.status = 'completed'
        WHERE c.updated_at > NOW() - INTERVAL '24 hours'
          AND ej.job_id IS NULL
        ON CONFLICT DO NOTHING
        RETURNING creator_id
    """
    
    result = postgres_hook.run(query, autocommit=True)
    
    logging.info(f"Queued {result} creators for enrichment")
    
    return result


def update_search_indexes(**context):
    """
    Trigger reindexing of search indexes (Pinecone, OpenSearch).
    """
    logging.info("Updating search indexes...")
    
    # In production, this would:
    # 1. Fetch creators updated in last 24 hours
    # 2. Generate embeddings
    # 3. Upsert to Pinecone
    # 4. Update OpenSearch index
    
    postgres_hook = PostgresHook(postgres_conn_id='increator_postgres')
    
    query = """
        SELECT COUNT(*)
        FROM creators
        WHERE updated_at > NOW() - INTERVAL '24 hours'
    """
    
    count = postgres_hook.get_first(query)[0]
    
    logging.info(f"Would update {count} creators in search indexes")
    
    return count


def send_completion_notification(**context):
    """
    Send completion notification with summary stats.
    """
    execution_date = context['execution_date']
    
    postgres_hook = PostgresHook(postgres_conn_id='increator_postgres')
    
    # Get summary stats
    query = """
        SELECT 
            platform,
            COUNT(*) as creators_updated,
            AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
        FROM ingestion_queue
        WHERE created_at > %(execution_date)s
          AND status = 'completed'
        GROUP BY platform
    """
    
    results = postgres_hook.get_records(
        query,
        parameters={'execution_date': execution_date}
    )
    
    summary = {row[0]: {'count': row[1], 'avg_duration': row[2]} for row in results}
    
    logging.info(f"Ingestion summary: {summary}")
    
    # In production, send to Slack/email
    message = f"""
    ✅ Daily Ingestion Complete
    
    Execution Date: {execution_date}
    
    Summary:
    {json.dumps(summary, indent=2)}
    """
    
    logging.info(message)
    
    return summary


# ==================== TASK DEFINITIONS ====================

# Start task
start = BashOperator(
    task_id='start',
    bash_command='echo "Starting daily ingestion pipeline..."',
    dag=dag
)

# Fetch creators for each platform
with TaskGroup('fetch_creators', dag=dag) as fetch_creators_group:
    for platform, config in PLATFORM_CONFIGS.items():
        PythonOperator(
            task_id=f'fetch_{platform}_creators',
            python_callable=fetch_creators_to_scrape,
            op_kwargs={
                'platform': platform,
                'batch_size': config['batch_size']
            },
            dag=dag
        )

# Publish to SQS queues
with TaskGroup('publish_to_queues', dag=dag) as publish_group:
    for platform in PLATFORM_CONFIGS.keys():
        PythonOperator(
            task_id=f'publish_{platform}_to_sqs',
            python_callable=publish_to_sqs,
            op_kwargs={'platform': platform},
            dag=dag
        )

# Monitor ingestion progress (wait 30 minutes)
wait_for_ingestion = BashOperator(
    task_id='wait_for_ingestion',
    bash_command='sleep 1800',  # 30 minutes
    dag=dag
)

# Monitor each platform
with TaskGroup('monitor_progress', dag=dag) as monitor_group:
    for platform in PLATFORM_CONFIGS.keys():
        PythonOperator(
            task_id=f'monitor_{platform}_progress',
            python_callable=monitor_ingestion_progress,
            op_kwargs={'platform': platform},
            dag=dag
        )

# Trigger enrichment
trigger_enrichment = PythonOperator(
    task_id='trigger_enrichment',
    python_callable=trigger_enrichment_pipeline,
    dag=dag
)

# Update search indexes
update_indexes = PythonOperator(
    task_id='update_search_indexes',
    python_callable=update_search_indexes,
    dag=dag
)

# Refresh materialized views
refresh_views = PostgresOperator(
    task_id='refresh_materialized_views',
    postgres_conn_id='increator_postgres',
    sql="""
        REFRESH MATERIALIZED VIEW CONCURRENTLY top_creators_by_niche;
    """,
    dag=dag
)

# Send notification
send_notification = PythonOperator(
    task_id='send_completion_notification',
    python_callable=send_completion_notification,
    dag=dag
)

# End task
end = BashOperator(
    task_id='end',
    bash_command='echo "Daily ingestion pipeline complete!"',
    dag=dag
)

# ==================== DAG DEPENDENCIES ====================

start >> fetch_creators_group >> publish_group >> wait_for_ingestion
wait_for_ingestion >> monitor_group >> trigger_enrichment
trigger_enrichment >> [update_indexes, refresh_views] >> send_notification >> end

# ==================== NOTES ====================

"""
Production Enhancements:
1. Add data quality checks (Great Expectations)
2. Implement circuit breakers for API failures
3. Add Slack/PagerDuty alerts for failures
4. Use Airflow Sensors to wait for SQS queue completion
5. Add backfill DAG for historical data
6. Implement incremental loading with checkpoints
7. Add cost tracking and budget alerts
8. Use Kubernetes Pod Operator for heavy processing
9. Implement data lineage tracking
10. Add A/B testing for different scraping strategies
"""
