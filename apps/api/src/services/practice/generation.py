"""Generate one extra practice task with the course assistant.

The generated item is a normal QUIZ task stored on an existing published
assignment, so it flows through the same authoring/grading/permission model as
every other task. The model only supplies the question payload; the server
validates it and chooses the course, topic, level and placement.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment, AssignmentTask, AssignmentTaskTypeEnum
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.services.practice import adaptive, state

OPENCODE_BASE_URL = os.environ.get(
    "OPENCODE_GO_BASE_URL", "https://opencode.ai/inference/go/v1"
).rstrip("/")
OPENCODE_API_KEY = os.environ.get("OPENCODE_API_KEY", "").strip()
MODEL = os.environ.get("LEARNHOUSE_ASSISTANT_MODEL", "deepseek-v4.1-flash")
TIMEOUT = float(os.environ.get("LEARNHOUSE_ASSISTANT_TIMEOUT", "75"))

SYSTEM_PROMPT = """Ты методист. Придумай ровно один короткий проверочный вопрос
по указанной теме курса. Верни только JSON без markdown:
{"title":"...", "question":"...", "options":["...","...","...","..."],
 "correct_index":0, "hint":"..."}
Правил: ровно 4 варианта, ровно один правильный, correct_index от 0 до 3,
все варианты различны, вопрос на русском, без ссылок и без кода."""


def _parse_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model did not return a JSON object")
    return json.loads(text[start : end + 1])


def _validate(data: dict) -> tuple[str, str, list[str], int, str]:
    title = str(data.get("title") or "").strip()[:300]
    question = str(data.get("question") or "").strip()[:2000]
    options = data.get("options")
    if not title or not question or not isinstance(options, list) or len(options) != 4:
        raise ValueError("invalid question shape")
    cleaned = [str(option).strip()[:500] for option in options]
    if any(not option for option in cleaned) or len(set(cleaned)) != 4:
        raise ValueError("options must be four distinct non-empty strings")
    try:
        correct = int(data.get("correct_index"))
    except (TypeError, ValueError):
        raise ValueError("correct_index must be an integer") from None
    if correct < 0 or correct > 3:
        raise ValueError("correct_index out of range")
    hint = str(data.get("hint") or "").strip()[:500]
    return title, question, cleaned, correct, hint


def _contents(key: str, topic_key: str, level: int, question: str, options: list[str], correct: int) -> dict:
    return {
        "_meta": {
            "key": key,
            "topic_key": topic_key,
            "level": level,
            "estimated_minutes": 5,
            "source": "ai-practice",
        },
        "questions": [
            {
                "questionUUID": f"question_{key}",
                "questionText": question,
                "response_type": "single",
                "options": [
                    {
                        "optionUUID": f"option_{key}_{index}",
                        "text": option,
                        "fileID": "",
                        "type": "text",
                        "assigned_right_answer": index == correct,
                    }
                    for index, option in enumerate(options)
                ],
            }
        ],
        "grading_mode": "all_or_nothing",
    }


async def _choose_target(
    db: AsyncSession, course: Course, user_id: int, requested_topic: str | None
) -> tuple[dict, int, int]:
    """Return (topic row, level, assignment id) for the generated task."""
    profile = await state.get_state(
        db, course=course, user_id=user_id, org_id=course.org_id
    )
    topics = profile.get("topics") or []
    topic = None
    if requested_topic:
        topic = next((row for row in topics if row.get("topic_key") == requested_topic), None)
    if topic is None and topics:
        topic = topics[0]  # get_state sorts weakest first
    if topic is None:
        chapter = (
            await db.execute(
                select(Chapter).where(Chapter.course_id == course.id).order_by(Chapter.id)
            )
        ).scalars().first()
        if chapter is None:
            raise HTTPException(status_code=400, detail="Course has no chapters")
        topic = {
            "topic_key": chapter.chapter_uuid,
            "topic_name": chapter.name,
            "mastery": 0.0,
        }
    level = adaptive.mastery_level(float(topic.get("mastery", 0) or 0))

    assignment = (
        await db.execute(
            select(Assignment)
            .join(Activity, Activity.id == Assignment.activity_id)
            .where(
                Assignment.course_id == course.id,
                Assignment.published.is_(True),
                Assignment.ungraded.is_not(True),
                Activity.published.is_(True),
            )
            .order_by(Assignment.id)
            .limit(1)
        )
    ).scalars().first()
    if assignment is None:
        raise HTTPException(
            status_code=400,
            detail="Course has no published assignment to attach a practice task to",
        )
    return topic, max(1, min(3, level)), int(assignment.id)


async def generate_ai_task(
    db: AsyncSession,
    *,
    course: Course,
    user_id: int,
    requested_topic: str | None = None,
) -> dict:
    if not OPENCODE_API_KEY:
        raise HTTPException(status_code=503, detail="AI assistant is not configured")

    topic, level, assignment_id = await _choose_target(
        db, course, user_id, requested_topic
    )
    assignment = await db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=400, detail="Assignment not found")

    prompt = (
        f"Курс: {course.name}\n"
        f"Описание: {(course.description or '')[:1200]}\n"
        f"Тема: {topic.get('topic_name') or topic.get('topic_key')}\n"
        f"Уровень: {level} из 3 (1 — база, 3 — сложно).\n"
        "Сделай один вопрос, который проверяет понимание именно этой темы."
    )
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{OPENCODE_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENCODE_API_KEY}",
                    "Content-Type": "application/json",
                    "User-Agent": "zerok-assistant/1.0",
                    "x-opencode-session": f"zerok-{uuid4()}",
                },
                json={
                    "model": MODEL,
                    "temperature": 0.4,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            response.raise_for_status()
            payload = response.json()
        raw = payload["choices"][0]["message"]["content"]
        data = _parse_json(raw)
        title, question, options, correct, hint = _validate(data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"AI could not generate a valid task: {exc}"
        ) from exc

    key = f"ai-{uuid4().hex[:12]}"
    contents = _contents(
        key,
        str(topic.get("topic_key") or ""),
        level,
        question,
        options,
        correct,
    )
    max_order = (
        await db.execute(
            select(func.max(AssignmentTask.order)).where(
                AssignmentTask.assignment_id == assignment.id
            )
        )
    ).scalar_one()
    task = AssignmentTask(
        title=title,
        description=question,
        hint=hint,
        reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.QUIZ,
        contents=contents,
        max_grade_value=10,
        assignment_task_uuid=f"assignmenttask_{uuid4()}",
        order=(max_order + 1) if max_order is not None else 0,
        creation_date=datetime.now().isoformat(timespec="seconds"),
        update_date=datetime.now().isoformat(timespec="seconds"),
        assignment_id=assignment.id,
        org_id=course.org_id,
        course_id=course.id,
        chapter_id=assignment.chapter_id,
        activity_id=assignment.activity_id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    activity = await db.get(Activity, assignment.activity_id) if assignment.activity_id else None
    return {
        "task_uuid": task.assignment_task_uuid,
        "title": task.title,
        "topic_key": topic.get("topic_key", ""),
        "topic_name": topic.get("topic_name", ""),
        "level": level,
        "assignment_uuid": assignment.assignment_uuid,
        "activity_uuid": activity.activity_uuid if activity else "",
    }
