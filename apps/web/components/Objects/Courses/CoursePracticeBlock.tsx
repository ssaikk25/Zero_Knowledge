'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

type FeedItem = {
  task_uuid: string
  title: string
  assignment_type: string
  activity_uuid: string
  topic_key: string
  topic_name: string
  level: number
  estimated_minutes: number
  reason: string
  mastery: number
  expected_success: number
  difficulty?: 'easier' | 'fit' | 'harder'
  xp: number
}

type Feed = {
  items: FeedItem[]
  items_count: number
  planned_xp: number
}

const REASONS: Record<string, { label: string; className: string }> = {
  new: { label: 'Новая тема', className: 'bg-sky-50 text-sky-700' },
  weak: { label: 'Слабая тема', className: 'bg-amber-50 text-amber-700' },
  review: { label: 'Повторение', className: 'bg-violet-50 text-violet-700' },
  stretch: { label: 'На вырост', className: 'bg-emerald-50 text-emerald-700' },
  practice: { label: 'Практика', className: 'bg-neutral-100 text-neutral-600' },
}

const DIFFICULTY: Record<string, string> = {
  easier: 'легче',
  fit: 'в уровень',
  harder: 'сложнее',
}

function TaskRow({ item, orgslug, courseUuid }: { item: FeedItem; orgslug: string; courseUuid: string }) {
  const reason = REASONS[item.reason] || REASONS.practice
  const activity = (item.activity_uuid || '').replace('activity_', '')
  const clean = courseUuid.startsWith('course_') ? courseUuid.slice('course_'.length) : courseUuid
  return (
    <Link
      href={getUriWithOrg(orgslug, `/course/${clean}/activity/${activity}`)}
      className="group flex items-start gap-2 rounded-xl border border-neutral-200 bg-white p-2.5 transition-colors hover:border-neutral-400"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${reason.className}`}>
            {reason.label}
          </span>
          {item.difficulty && (
            <span className="text-[10px] font-semibold text-black/35">
              {DIFFICULTY[item.difficulty] || item.difficulty}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-xs font-bold leading-snug text-black">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-black/40">
          {item.topic_name} · {Math.round(item.expected_success * 100)}% шанс
        </p>
      </div>
      <ChevronRight size={14} className="mt-1 shrink-0 text-black/25 group-hover:text-black" />
    </Link>
  )
}

export default function CoursePracticeBlock({
  courseUuid,
  orgslug,
}: {
  courseUuid: string
  orgslug: string
}) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const authenticated = session?.status === 'authenticated'
  const course = courseUuid.startsWith('course_') ? courseUuid : `course_${courseUuid}`
  const clean = courseUuid.startsWith('course_') ? courseUuid.slice('course_'.length) : courseUuid
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')

  const feed = useQuery<Feed>({
    queryKey: ['course-practice-block', course],
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}practice/today?course_uuid=${encodeURIComponent(course)}&limit=8`,
        token
      ),
    enabled: !!token && !!courseUuid,
    staleTime: 20_000,
    retry: false,
  })

  const items = feed.data?.items ?? []
  const review = useMemo(() => items.filter((item) => item.reason === 'review'), [items])
  const recommended = useMemo(() => items.filter((item) => item.reason !== 'review'), [items])

  const generate = async () => {
    if (!token || generating) return
    setGenerating(true)
    setMessage('')
    try {
      const response = await fetch(`${getAPIUrl()}practice/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ course_uuid: course }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.detail || 'Не удалось сгенерировать задачу')
      }
      setMessage(`ИИ добавил задачу: ${payload.title}`)
      await feed.refetch()
    } catch (error: any) {
      setMessage(error?.message || 'Ошибка генерации')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-md shadow-gray-300/25">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-black text-black">
            <Target size={14} />
            Задачи для вас
          </p>
          <p className="text-[10px] text-black/40">
            {authenticated ? 'Подобрано по вашему прогрессу' : 'Войдите, чтобы увидеть подборку'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => feed.refetch()}
            aria-label="Обновить подборку"
            className="rounded-md p-1 text-black/30 hover:bg-neutral-100 hover:text-black"
            title="Обновить"
          >
            <RefreshCw size={13} className={feed.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!authenticated && (
        <Link
          href={getUriWithOrg(orgslug, '/login')}
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-black px-3 py-2 text-xs font-bold text-white"
        >
          Войти <ArrowRight size={13} />
        </Link>
      )}

      {authenticated && (
        <>
          <div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto pe-0.5">
            {feed.isLoading && (
              <div className="space-y-2">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="h-16 animate-pulse rounded-xl bg-neutral-100" />
                ))}
              </div>
            )}

            {feed.isError && (
              <p className="rounded-xl bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700">
                Не удалось загрузить подборку.
              </p>
            )}

            {!feed.isLoading && !feed.isError && items.length === 0 && (
              <p className="rounded-xl bg-neutral-50 px-2.5 py-2 text-[11px] text-black/50">
                Пока нет заданий. Сгенерируйте первую ИИ-задачу.
              </p>
            )}

            {recommended.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-black/35">
                  Рекомендовано
                </p>
                <div className="space-y-1.5">
                  {recommended.slice(0, 3).map((item) => (
                    <TaskRow
                      key={item.task_uuid}
                      item={item}
                      orgslug={orgslug}
                      courseUuid={courseUuid}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-black/35">
                <Clock3 size={11} />
                Повторение
              </p>
              {review.length > 0 ? (
                <div className="space-y-1.5">
                  {review.slice(0, 3).map((item) => (
                    <TaskRow
                      key={item.task_uuid}
                      item={item}
                      orgslug={orgslug}
                      courseUuid={courseUuid}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-neutral-50 px-2 py-1.5 text-[10px] text-black/40">
                  Сейчас повторений нет — они появятся по расписанию.
                </p>
              )}
            </div>
          </div>

          {message && (
            <p className="mt-2 line-clamp-2 rounded-lg bg-neutral-50 px-2 py-1.5 text-[10px] text-black/55">
              {message}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Link
              href={getUriWithOrg(orgslug, `/course/${clean}/practice`)}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-neutral-200 px-2.5 py-2 text-[11px] font-bold text-black/65 hover:border-neutral-400 hover:text-black"
            >
              Вся практика <ArrowRight size={12} />
            </Link>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-black px-2.5 py-2 text-[11px] font-bold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {generating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {generating ? 'Генерирую…' : 'ИИ-задача'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
