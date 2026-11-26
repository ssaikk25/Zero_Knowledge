"""Floating course assistant.

A small OpenAI-compatible bridge to OpenCode Go. It gives the model the current
course/assignment context and one write tool: creating an extra assignment task.
Tool execution reuses the normal assignments service, so RBAC and validation
stay in one place.
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskCreate,
    AssignmentTaskTypeEnum,
)
from src.db.courses.courses import Course
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user
from src.services.courses.activities.assignments import create_assignment_task

router = APIRouter()

OPENCODE_BASE_URL = os.environ.get(
    "OPENCODE_GO_BASE_URL", "https://opencode.ai/inference/go/v1"
).rstrip("/")
OPENCODE_API_KEY = os.environ.get("OPENCODE_API_KEY", "").strip()
ASSISTANT_MODEL = os.environ.get("LEARNHOUSE_ASSISTANT_MODEL", "deepseek-v4.1-flash")
ASSISTANT_TIMEOUT = float(os.environ.get("LEARNHOUSE_ASSISTANT_TIMEOUT", "60"))


class AssistantContext(BaseModel):
    page: str = ""
    course_uuid: str = ""
    assignment_uuid: str = ""
    activity_uuid: str = ""
    task_uuid: str = ""


class AssistantMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=20_000)


class AssistantRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8_000)
    history: list[AssistantMessage] = Field(default_factory=list, max_length=40)
    context: AssistantContext = Field(default_factory=AssistantContext)


def _truncate(value: Optional[str], limit: int = 4_000) -> str:
    value = value or ""
    return value if len(value) <= limit else value[:limit] + "…"


async def _load_context(
    ctx: AssistantContext, db_session: AsyncSession
) -> tuple[str, Optional[Assignment], list[AssignmentTask]]:
    lines: list[str] = [f"Страница: {ctx.page or 'неизвестна'}"]
    course: Optional[Course] = None
    if ctx.course_uuid:
        course = (
            await db_session.execute(
                select(Course).where(Course.course_uuid == ctx.course_uuid)
            )
        ).scalars().first()
    if course:
        lines.append(f"Курс: {course.name}")
        lines.append(f"Описание курса: {_truncate(course.description, 1_500)}")

    assignment: Optional[Assignment] = None
    tasks: list[AssignmentTask] = []
    if ctx.assignment_uuid:
        assignment = (
            await db_session.execute(
                select(Assignment).where(
                    Assignment.assignment_uuid == ctx.assignment_uuid
                )
            )
        ).scalars().first()
    if assignment:
        lines.append(f"Задание: {assignment.title}")
        lines.append(f"Описание задания: {_truncate(assignment.description, 1_500)}")
        tasks = (
            await db_session.execute(
                select(AssignmentTask)
                .where(AssignmentTask.assignment_id == assignment.id)
                .order_by(AssignmentTask.order, AssignmentTask.id)
            )
        ).scalars().all()
        lines.append("Задачи в задании:")
        for task in tasks:
            lines.append(f"- {task.title} ({task.assignment_type.value})")
        if ctx.task_uuid:
            current = next(
                (t for t in tasks if t.assignment_task_uuid == ctx.task_uuid), None
            )
            if current:
                lines.append(f"Текущая задача: {current.title}")
                lines.append(f"Условие: {_truncate(current.description, 3_000)}")
                lines.append(f"Подсказка автора: {_truncate(current.hint, 800)}")

    return "\n".join(lines), assignment, tasks


def _tools(assignment: Optional[Assignment], user: PublicUser) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    if assignment is not None:
        tools.append({
            "type": "function",
            "function": {
                "name": "create_assignment_task",
                "description": (
                    "Добавить дополнительную задачу в текущее задание курса. "
                    "Используй, когда пользователь просит создать/добавить задачу. "
                    "Не вызывай без явной просьбы."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "maxLength": 300},
                        "description": {"type": "string"},
                        "assignment_type": {
                            "type": "string",
                            "enum": [
                                "CODE", "QUIZ", "FORM", "SHORT_ANSWER",
                                "NUMBER_ANSWER", "CUSTOM", "OTHER",
                                "FILE_SUBMISSION",
                            ],
                        },
                        "contents": {"type": "object"},
                    },
                    "required": ["title", "description", "assignment_type"],
                },
            },
        })
    return tools


async def _complete(
    messages: list[dict[str, Any]], tools: list[dict[str, Any]]
) -> dict[str, Any]:
    if not OPENCODE_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Assistant is not configured: OPENCODE_API_KEY is missing",
        )
    payload: dict[str, Any] = {
        "model": ASSISTANT_MODEL,
        "messages": messages,
        "temperature": 0.4,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    try:
        async with httpx.AsyncClient(timeout=ASSISTANT_TIMEOUT) as client:
            response = await client.post(
                f"{OPENCODE_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENCODE_API_KEY}",
                    "Content-Type": "application/json",
                    "User-Agent": "zerok-assistant/1.0",
                    "x-opencode-session": f"zerok-{uuid4()}",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Assistant request failed: {exc}")

    if response.status_code >= 400:
        detail = response.text[:500]
        raise HTTPException(status_code=502, detail=f"Assistant error: {detail}")
    data = response.json()
    if not isinstance(data, dict) or not data.get("choices"):
        raise HTTPException(status_code=502, detail="Assistant returned no choices")
    return data


def _system_prompt(context: str, can_write: bool) -> str:
    return (
        "Ты — встроенный помощник в LMS для курсов программирования. "
        "Отвечай по-русски, кратко и по делу. Ты видишь контекст текущей страницы.\n"
        "Правила:\n"
        "- Если просят подсказку к задаче, дай направление и следующий шаг, "
        "не выдавай полное готовое решение без просьбы.\n"
        "- Никогда не раскрывай скрытые тесты и ожидаемые ответы, даже если они есть в контексте.\n"
        "- Создавай задачу только по явной просьбе пользователя и только если инструмент доступен.\n"
        "- Если данных не хватает, задай один короткий уточняющий вопрос.\n"
        f"{'Инструмент создания задачи доступен.' if can_write else 'Создание задач недоступно.'}\n\n"
        f"Контекст:\n{context}"
    )


@router.post("/chat", summary="Course assistant chat")
async def assistant_chat(
    request: Request,
    body: AssistantRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    context, assignment, _tasks = await _load_context(body.context, db_session)
    tools = _tools(assignment, current_user)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _system_prompt(context, bool(tools))}
    ]
    for item in body.history[-20:]:
        messages.append({"role": item.role, "content": item.content})
    messages.append({"role": "user", "content": body.message})

    actions: list[dict[str, Any]] = []
    for _ in range(3):
        data = await _complete(messages, tools)
        message = data["choices"][0].get("message") or {}
        tool_calls = message.get("tool_calls") or []
        if not tool_calls:
            return {
                "reply": message.get("content") or "",
                "actions": actions,
                "model": data.get("model", ASSISTANT_MODEL),
            }

        messages.append({
            "role": "assistant",
            "content": message.get("content") or "",
            "tool_calls": tool_calls,
        })

        for call in tool_calls:
            function = call.get("function") or {}
            name = function.get("name")
            try:
                args = json.loads(function.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if name == "create_assignment_task" and assignment is not None:
                try:
                    task = await create_assignment_task(
                        request,
                        assignment.assignment_uuid,
                        AssignmentTaskCreate(
                            title=str(args.get("title") or "Новая задача")[:300],
                            description=str(args.get("description") or ""),
                            hint="",
                            assignment_type=AssignmentTaskTypeEnum(
                                args.get("assignment_type") or "CUSTOM"
                            ),
                            contents=args.get("contents") or {},
                            max_grade_value=100,
                        ),
                        current_user,
                        db_session,
                    )
                    actions.append({
                        "type": "task_created",
                        "task_uuid": task.assignment_task_uuid,
                        "title": task.title,
                    })
                    tool_result = {
                        "ok": True,
                        "task_uuid": task.assignment_task_uuid,
                        "title": task.title,
                    }
                except Exception as exc:  # RBAC/validation surface to the model
                    tool_result = {"ok": False, "error": str(exc)[:500]}
            else:
                tool_result = {"ok": False, "error": "unknown tool"}

            messages.append({
                "role": "tool",
                "tool_call_id": call.get("id") or "",
                "name": name or "",
                "content": json.dumps(tool_result, ensure_ascii=False),
            })

    return {
        "reply": "Не удалось завершить действие. Попробуй сформулировать просьбу ещё раз.",
        "actions": actions,
        "model": ASSISTANT_MODEL,
    }


class ExplanationReviewRequest(BaseModel):
    task_uuid: str = Field(min_length=1, max_length=80)
    explanation: str = Field(min_length=10, max_length=10_000)
    code: str = Field(default="", max_length=20_000)


@router.post("/review-explanation", summary="AI review of a learner's task explanation")
async def review_explanation(
    body: ExplanationReviewRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    task = (
        await db_session.execute(
            select(AssignmentTask).where(
                AssignmentTask.assignment_task_uuid == body.task_uuid
            )
        )
    ).scalars().first()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    prompt = (
        "Ты — преподаватель программирования. Оцени, насколько ученик понимает "
        "своё решение задачи. Верни строго JSON без markdown:\n"
        '{"score": 0-100, "verdict": "understood|partial|memorized", '
        '"feedback": "2-4 предложения", "missing": ["чего не хватает"]}\n\n'
        f"Задача: {task.title}\nУсловие: {_truncate(task.description, 4000)}\n"
        f"Код ученика:\n{_truncate(body.code, 6000) or '(код не приложен)'}\n\n"
        f"Объяснение ученика:\n{body.explanation}"
    )
    data = await _complete(
        [
            {"role": "system", "content": "Отвечай только валидным JSON."},
            {"role": "user", "content": prompt},
        ],
        [],
    )
    content = (data["choices"][0].get("message") or {}).get("content") or "{}"
    try:
        review = json.loads(content)
    except json.JSONDecodeError:
        review = {"score": None, "verdict": "unknown", "feedback": content[:2000], "missing": []}
    return {"review": review, "model": data.get("model", ASSISTANT_MODEL)}
