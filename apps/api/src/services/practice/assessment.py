"""Explainable knowledge assessment for adaptive practice.

The assessment is derived from the same projected topic mastery the feed uses,
so the number a learner sees and the tasks they are served cannot disagree.
It is intentionally simple and auditable:

* the score is mastery over the topics the learner has actually started;
* coverage and confidence are reported separately instead of inflating the
  score for a learner who answered one easy task;
* the grade maps to the familiar 2..5 scale and a named level;
* weaknesses are ordered by mastery and due reviews are called out first.

Pure functions only: no database, no clock of its own.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional, Sequence

from src.services.practice import adaptive

GRADES = (
    (0.9, "5", "Отлично", "expert", "Эксперт"),
    (0.75, "4", "Хорошо", "confident", "Уверенный"),
    (0.6, "3", "Удовлетворительно", "learning", "Ученик"),
    (0.0, "2", "Начальный уровень", "novice", "Новичок"),
)

MASTERY_STRONG = 0.75
MASTERY_WEAK = 0.5
CONFIDENCE_ENOUGH = 0.5


def topic_status(topic: dict, now: datetime) -> str:
    due = adaptive.parse_dt(topic.get("next_review_at", ""))
    if due is not None and due <= now and topic.get("mastery", 0) >= MASTERY_WEAK:
        return "review"
    mastery = float(topic.get("mastery", 0) or 0)
    if mastery < MASTERY_WEAK:
        return "weak"
    if mastery < MASTERY_STRONG:
        return "developing"
    return "strong"


def _topic_row(topic: dict, now: datetime) -> dict:
    return {
        "topic_key": topic.get("topic_key", ""),
        "topic_name": topic.get("topic_name") or topic.get("topic_key", ""),
        "mastery": round(float(topic.get("mastery", 0) or 0), 3),
        "confidence": round(float(topic.get("confidence", 0) or 0), 3),
        "attempts": int(topic.get("attempts", 0) or 0),
        "next_review_at": topic.get("next_review_at", ""),
        "status": topic_status(topic, now),
    }


def grade_for_score(score: float) -> tuple[str, str, str, str]:
    value = adaptive.clamp(score)
    for threshold, grade, label, level, level_label in GRADES:
        if value >= threshold:
            return grade, label, level, level_label
    return GRADES[-1][1], GRADES[-1][2], GRADES[-1][3], GRADES[-1][4]


def build_profile(
    topics: Iterable[dict],
    *,
    attempts: int = 0,
    active_days: int = 0,
    streak_days: int = 0,
    now: Optional[datetime] = None,
) -> dict:
    """Return the learner's knowledge profile for one course.

    ``topics`` are projected mastery rows. Unstarted topics are not present, so
    the score is explicitly "по изученным темам" and coverage is reported
    alongside it.
    """
    now = now or datetime.now()
    rows = [_topic_row(topic, now) for topic in topics]
    started = [row for row in rows if row["attempts"] > 0]
    # A topic row without attempts (rare: seeded mastery) must not be treated
    # as evidence of knowledge.
    evidence = started or rows
    if evidence:
        score = sum(row["mastery"] for row in evidence) / len(evidence)
    else:
        score = 0.0
    confidence = (
        sum(row["confidence"] for row in evidence) / len(evidence) if evidence else 0.0
    )
    grade, grade_label, level, level_label = grade_for_score(score)
    if not evidence:
        grade, grade_label, level, level_label = (
            "—",
            "Нет данных",
            "unrated",
            "Без оценки",
        )

    ordered_weak = sorted(
        (row for row in evidence if row["status"] in {"weak", "developing"}),
        key=lambda row: (row["mastery"], row["topic_key"]),
    )
    ordered_strong = sorted(
        (row for row in evidence if row["status"] == "strong"),
        key=lambda row: (-row["mastery"], row["topic_key"]),
    )
    due = sorted(
        (row for row in evidence if row["status"] == "review"),
        key=lambda row: (row["next_review_at"], row["topic_key"]),
    )

    focus = ordered_weak[0] if ordered_weak else (due[0] if due else None)
    if not evidence:
        next_action = "Решите первую задачу — оценка появится после проверки."
    elif focus is None:
        next_action = "Держите темп: добавьте задачу на вырост."
    elif focus["status"] == "review":
        next_action = f"Пора повторить «{focus['topic_name']}»."
    else:
        next_action = f"Начните с «{focus['topic_name']}» — там самый большой пробел."

    return {
        "score": round(score, 3),
        "score_percent": round(score * 100),
        "grade": grade,
        "grade_label": grade_label,
        "level": level,
        "level_label": level_label,
        "confidence": round(confidence, 3),
        "confidence_enough": confidence >= CONFIDENCE_ENOUGH,
        "topics_started": len(started),
        "topics_strong": len(ordered_strong),
        "topics_weak": len(ordered_weak),
        "due_reviews": len(due),
        "attempts": int(attempts),
        "active_days": int(active_days),
        "streak_days": int(streak_days),
        "strengths": ordered_strong[:3],
        "weaknesses": ordered_weak[:3],
        "next_action": next_action,
    }


def feed_difficulty(mastery: float, level: int) -> str:
    """Human label for why a task is easy, fitting or a stretch."""
    expected_level = adaptive.mastery_level(float(mastery))
    if int(level) < expected_level:
        return "easier"
    if int(level) > expected_level:
        return "harder"
    return "fit"

