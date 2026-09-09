from sqlalchemy import Column, String, DateTime, BigInteger, Boolean, Index, Text, Integer, func
from app.database import Base


class GrowthExperiment(Base):
    __tablename__ = "growth_experiments"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    variant_a = Column(String, nullable=False, default="control")
    variant_b = Column(String, nullable=False, default="treatment")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_growth_experiments_name", "name"),
        Index("idx_growth_experiments_active", "is_active"),
    )


class ExperimentAssignment(Base):
    __tablename__ = "experiment_assignments"

    id = Column(String, primary_key=True)
    experiment_id = Column(String, nullable=False)
    developer_id = Column(String, nullable=True)
    email = Column(String, nullable=True)
    variant = Column(String, nullable=False)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    converted = Column(Boolean, nullable=False, default=False)
    converted_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_experiment_assignments_experiment", "experiment_id"),
        Index("idx_experiment_assignments_developer", "developer_id"),
        Index("idx_experiment_assignments_email", "email"),
    )


class EmailDripSchedule(Base):
    __tablename__ = "email_drip_schedule"

    id = Column(String, primary_key=True)
    developer_id = Column(String, nullable=False)
    email = Column(String, nullable=False)
    sequence_day = Column(Integer, nullable=False)
    email_type = Column(String, nullable=False)
    scheduled_for = Column(DateTime(timezone=True), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    opened_at = Column(DateTime(timezone=True), nullable=True)
    clicked_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_email_drip_developer", "developer_id"),
        Index("idx_email_drip_scheduled", "scheduled_for"),
        Index("idx_email_drip_status", "status"),
    )


class DeveloperActivation(Base):
    __tablename__ = "developer_activations"

    id = Column(String, primary_key=True)
    developer_id = Column(String, nullable=False, unique=True)
    email = Column(String, nullable=False)
    signup_experiment_variant = Column(String, nullable=True)
    signup_discovery_path = Column(String, nullable=True)
    signup_referrer = Column(String, nullable=True)
    utm_source = Column(String, nullable=True)
    utm_medium = Column(String, nullable=True)
    utm_campaign = Column(String, nullable=True)
    utm_content = Column(String, nullable=True)
    utm_term = Column(String, nullable=True)
    first_query_at = Column(DateTime(timezone=True), nullable=True)
    first_query_latency_seconds = Column(BigInteger, nullable=True)
    activated_24h = Column(Boolean, nullable=False, default=False)
    activated_7d = Column(Boolean, nullable=False, default=False)
    referral_code_used = Column(String, nullable=True)
    playground_used = Column(Boolean, nullable=False, default=False)
    docs_first = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_developer_activations_developer", "developer_id"),
        Index("idx_developer_activations_email", "email"),
        Index("idx_developer_activations_signup_variant", "signup_experiment_variant"),
        Index("idx_developer_activations_activated_24h", "activated_24h"),
    )


class GrowthMetrics(Base):
    __tablename__ = "growth_metrics"

    id = Column(String, primary_key=True)
    date = Column(DateTime(timezone=True), nullable=False)
    experiment_name = Column(String, nullable=True)
    variant = Column(String, nullable=True)
    signups = Column(BigInteger, nullable=False, default=0)
    activated_24h = Column(BigInteger, nullable=False, default=0)
    activated_7d = Column(BigInteger, nullable=False, default=0)
    total_api_calls = Column(BigInteger, nullable=False, default=0)
    playground_used = Column(BigInteger, nullable=False, default=0)
    docs_first = Column(BigInteger, nullable=False, default=0)
    referral_signups = Column(BigInteger, nullable=False, default=0)
    email_drip_opens = Column(BigInteger, nullable=False, default=0)
    email_drip_clicks = Column(BigInteger, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_growth_metrics_date", "date"),
        Index("idx_growth_metrics_experiment", "experiment_name"),
    )