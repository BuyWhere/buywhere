import hashlib
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.growth import (
    GrowthExperiment, ExperimentAssignment, EmailDripSchedule,
    DeveloperActivation, GrowthMetrics
)


EXPERIMENTS = {
    "cta_variation": {
        "name": "cta_variation",
        "variant_a": "Try API Free",
        "variant_b": "Start Building",
    },
    "discovery_path": {
        "name": "discovery_path",
        "variant_a": "playground_first",
        "variant_b": "docs_first",
    },
    "onboarding_email": {
        "name": "onboarding_email",
        "variant_a": "3_email_series",
        "variant_b": "single_welcome",
    },
}


def assign_variant(experiment_name: str, identifier: str) -> str:
    h = hashlib.sha256(f"{experiment_name}:{identifier}".encode()).hexdigest()
    return "a" if int(h[:8], 16) % 2 == 0 else "b"


async def get_or_create_experiment(db: AsyncSession, name: str) -> GrowthExperiment:
    result = await db.execute(
        select(GrowthExperiment).where(GrowthExperiment.name == name)
    )
    experiment = result.scalar_one_or_none()
    if experiment is None:
        exp_config = EXPERIMENTS.get(name, {})
        experiment = GrowthExperiment(
            id=str(uuid.uuid4()),
            name=name,
            description=exp_config.get("description", ""),
            variant_a=exp_config.get("variant_a", "control"),
            variant_b=exp_config.get("variant_b", "treatment"),
            is_active=True,
        )
        db.add(experiment)
        await db.flush()
    return experiment


async def track_signup(
    db: AsyncSession,
    developer_id: str,
    email: str,
    experiment_variant: Optional[str] = None,
    discovery_path: Optional[str] = None,
    referrer: Optional[str] = None,
    utm_source: Optional[str] = None,
    utm_medium: Optional[str] = None,
    utm_campaign: Optional[str] = None,
    utm_content: Optional[str] = None,
    utm_term: Optional[str] = None,
) -> DeveloperActivation:
    activation = DeveloperActivation(
        id=str(uuid.uuid4()),
        developer_id=developer_id,
        email=email,
        signup_experiment_variant=experiment_variant,
        signup_discovery_path=discovery_path,
        signup_referrer=referrer,
        utm_source=utm_source,
        utm_medium=utm_medium,
        utm_campaign=utm_campaign,
        utm_content=utm_content,
        utm_term=utm_term,
    )
    db.add(activation)
    await db.flush()
    return activation


async def track_first_query(
    db: AsyncSession,
    developer_id: str,
    latency_seconds: Optional[int] = None,
) -> bool:
    result = await db.execute(
        select(DeveloperActivation).where(
            DeveloperActivation.developer_id == developer_id
        )
    )
    activation = result.scalar_one_or_none()
    if activation is None:
        return False

    now = datetime.now(timezone.utc)
    activation.first_query_at = now
    if latency_seconds is not None:
        activation.first_query_latency_seconds = latency_seconds

    hours_since_signup = (now - activation.created_at).total_seconds() / 3600
    if hours_since_signup <= 24:
        activation.activated_24h = True
    if hours_since_signup <= 168:
        activation.activated_7d = True

    await db.flush()
    return True


async def track_playground_use(
    db: AsyncSession,
    developer_id: str,
) -> bool:
    result = await db.execute(
        select(DeveloperActivation).where(
            DeveloperActivation.developer_id == developer_id
        )
    )
    activation = result.scalar_one_or_none()
    if activation:
        activation.playground_used = True
        await db.flush()
        return True
    return False


async def track_docs_first(
    db: AsyncSession,
    developer_id: str,
) -> bool:
    result = await db.execute(
        select(DeveloperActivation).where(
            DeveloperActivation.developer_id == developer_id
        )
    )
    activation = result.scalar_one_or_none()
    if activation:
        activation.docs_first = True
        await db.flush()
        return True
    return False


async def schedule_email_drip(
    db: AsyncSession,
    developer_id: str,
    email: str,
) -> list[EmailDripSchedule]:
    schedules = []
    now = datetime.now(timezone.utc)

    drip_sequence = [
        (0, "welcome"),
        (3, "day3"),
        (7, "day7"),
    ]

    for day_offset, email_type in drip_sequence:
        schedule = EmailDripSchedule(
            id=str(uuid.uuid4()),
            developer_id=developer_id,
            email=email,
            sequence_day=day_offset,
            email_type=email_type,
            scheduled_for=now + timedelta(days=day_offset),
            status="pending",
        )
        db.add(schedule)
        schedules.append(schedule)

    await db.flush()
    return schedules


async def get_pending_emails(
    db: AsyncSession,
    limit: int = 100,
) -> list[EmailDripSchedule]:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(EmailDripSchedule)
        .where(
            EmailDripSchedule.status == "pending",
            EmailDripSchedule.scheduled_for <= now,
        )
        .order_by(EmailDripSchedule.scheduled_for)
        .limit(limit)
    )
    return list(result.scalars().all())


async def mark_email_sent(
    db: AsyncSession,
    schedule_id: str,
) -> bool:
    await db.execute(
        update(EmailDripSchedule)
        .where(EmailDripSchedule.id == schedule_id)
        .values(status="sent", sent_at=datetime.now(timezone.utc))
    )
    await db.flush()
    return True


async def mark_email_opened(
    db: AsyncSession,
    schedule_id: str,
) -> bool:
    await db.execute(
        update(EmailDripSchedule)
        .where(EmailDripSchedule.id == schedule_id)
        .values(status="opened", opened_at=datetime.now(timezone.utc))
    )
    await db.flush()
    return True


async def mark_email_clicked(
    db: AsyncSession,
    schedule_id: str,
) -> bool:
    await db.execute(
        update(EmailDripSchedule)
        .where(EmailDripSchedule.id == schedule_id)
        .values(status="clicked", clicked_at=datetime.now(timezone.utc))
    )
    await db.flush()
    return True


async def record_daily_metrics(
    db: AsyncSession,
    date: datetime,
) -> GrowthMetrics:
    metrics_id = str(uuid.uuid4())
    metrics = GrowthMetrics(
        id=metrics_id,
        date=date,
    )

    result = await db.execute(
        select(
            func.count(DeveloperActivation.id),
        ).where(
            func.date(DeveloperActivation.created_at) == date.date()
        )
    )
    metrics.signups = result.scalar() or 0

    result = await db.execute(
        select(
            func.count(DeveloperActivation.id),
        ).where(
            DeveloperActivation.activated_24h is True,
            func.date(DeveloperActivation.created_at) == date.date(),
        )
    )
    metrics.activated_24h = result.scalar() or 0

    result = await db.execute(
        select(
            func.count(DeveloperActivation.id),
        ).where(
            DeveloperActivation.activated_7d is True,
            func.date(DeveloperActivation.created_at) == date.date(),
        )
    )
    metrics.activated_7d = result.scalar() or 0

    result = await db.execute(
        select(
            func.count(DeveloperActivation.id),
        ).where(
            DeveloperActivation.playground_used is True,
            func.date(DeveloperActivation.created_at) == date.date(),
        )
    )
    metrics.playground_used = result.scalar() or 0

    result = await db.execute(
        select(
            func.count(DeveloperActivation.id),
        ).where(
            DeveloperActivation.docs_first is True,
            func.date(DeveloperActivation.created_at) == date.date(),
        )
    )
    metrics.docs_first = result.scalar() or 0

    result = await db.execute(
        select(
            func.count(EmailDripSchedule.id),
        ).where(
            EmailDripSchedule.status == "opened",
            func.date(EmailDripSchedule.sent_at) == date.date(),
        )
    )
    metrics.email_drip_opens = result.scalar() or 0

    result = await db.execute(
        select(
            func.count(EmailDripSchedule.id),
        ).where(
            EmailDripSchedule.status == "clicked",
            func.date(EmailDripSchedule.sent_at) == date.date(),
        )
    )
    metrics.email_drip_clicks = result.scalar() or 0

    db.add(metrics)
    await db.flush()
    return metrics


async def get_experiment_metrics(
    db: AsyncSession,
    experiment_name: str,
) -> dict:
    result = await db.execute(
        select(ExperimentAssignment)
        .where(ExperimentAssignment.experiment_id == experiment_name)
    )
    assignments = list(result.scalars().all())

    variant_a_signups = sum(1 for a in assignments if a.variant == "a")
    variant_b_signups = sum(1 for a in assignments if a.variant == "b")
    variant_a_converted = sum(1 for a in assignments if a.variant == "a" and a.converted)
    variant_b_converted = sum(1 for a in assignments if a.variant == "b" and a.converted)

    return {
        "experiment": experiment_name,
        "variant_a_signups": variant_a_signups,
        "variant_b_signups": variant_b_signups,
        "variant_a_converted": variant_a_converted,
        "variant_b_converted": variant_b_converted,
        "variant_a_conversion_rate": variant_a_converted / variant_a_signups if variant_a_signups > 0 else 0,
        "variant_b_conversion_rate": variant_b_converted / variant_b_signups if variant_b_signups > 0 else 0,
    }