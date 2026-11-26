"""Knowledge assessment: grades, strengths, weaknesses and feed labels."""

from __future__ import annotations

from datetime import datetime, timedelta

from src.services.practice import assessment


NOW = datetime(2026, 11, 24, 12, 0, 0)


def _topic(key: str, mastery: float, *, confidence: float = 0.8,
           attempts: int = 3, review_in_days: int | None = None) -> dict:
    review_at = (
        (NOW + timedelta(days=review_in_days)).isoformat(timespec="seconds")
        if review_in_days is not None
        else ""
    )
    return {
        "topic_key": key,
        "topic_name": key.title(),
        "mastery": mastery,
        "confidence": confidence,
        "attempts": attempts,
        "next_review_at": review_at,
    }


def test_no_evidence_is_not_graded_as_failure() -> None:
    profile = assessment.build_profile([], now=NOW)
    assert profile["grade"] == "—"
    assert profile["level"] == "unrated"
    assert profile["score_percent"] == 0
    assert "первую задачу" in profile["next_action"]


def test_weak_topics_drive_the_grade_and_focus() -> None:
    profile = assessment.build_profile(
        [
            _topic("loops", 0.2),
            _topic("arrays", 0.35),
            _topic("graphs", 0.9),
        ],
        now=NOW,
    )
    assert profile["score"] < 0.5
    assert profile["grade"] == "2"
    assert profile["weaknesses"][0]["topic_key"] == "loops"
    assert profile["strengths"][0]["topic_key"] == "graphs"
    assert "Loops" in profile["next_action"]


def test_strong_mastery_maps_to_top_grade() -> None:
    profile = assessment.build_profile(
        [_topic("loops", 0.92), _topic("arrays", 0.88)], now=NOW
    )
    assert profile["grade"] == "5"
    assert profile["level"] == "expert"
    assert profile["topics_strong"] == 2


def test_due_review_is_called_out_before_more_practice() -> None:
    profile = assessment.build_profile(
        [_topic("loops", 0.8, review_in_days=0)], now=NOW
    )
    assert profile["due_reviews"] == 1
    assert profile["weaknesses"] == []
    assert "повторить" in profile["next_action"].lower()


def test_attempt_free_rows_do_not_inflate_the_score() -> None:
    profile = assessment.build_profile(
        [_topic("loops", 0.9, attempts=0), _topic("arrays", 0.4, attempts=2)],
        now=NOW,
    )
    assert profile["score"] == 0.4
    assert profile["topics_started"] == 1


def test_feed_difficulty_is_relative_to_mastery() -> None:
    assert assessment.feed_difficulty(0.2, 1) == "fit"
    assert assessment.feed_difficulty(0.9, 1) == "easier"
    assert assessment.feed_difficulty(0.2, 3) == "harder"
