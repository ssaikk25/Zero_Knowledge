'use client'

import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronRight,
  Clock3,
  Flame,
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
  course_uuid: string
  goal_xp: number
  planned_xp: number
  items_count: number
  items: FeedItem[]
}

type TopicRow = {
  topic_key: string
  topic_name: string
  mastery: number
  confidence: number
  attempts: number
  passed: number
  next_review_at: string
  status?: string
}

type Assessment = {
  score_percent: number
  grade: string
  grade_label: string
  level: string
  level_label: string
  confidence: number
  confidence_enough: boolean
  topics_started: number
  topics_strong: number
  topics_weak: number
  due_reviews: number
  strengths: TopicRow[]
  weaknesses: TopicRow[]
  next_action: string
}

type PracticeState = {
  course_uuid: string
  assessment?: Assessment
  summary: {
    topics_started: number
    topics_mastered: number
    average_mastery: number
    attempts: number
    active_days: number
    streak_days: number
    goal_xp: number
  }
  topics: TopicRow[]
}

const REASON_STYLES: Record<
  string,
  { label: string; className: string; Icon: React.ElementType }
> = {
  new: {
    label: 'Новая тема',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
    Icon: Sparkles,
  },
  weak: {
    label: 'Слабая тема',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    Icon: Target,
  },
  review: {
    label: 'Пора повторить',
    className: 'border-violet-200 bg-violet-50 text-violet-700',
    Icon: RefreshCw,
  },
  stretch: {
    label: 'На вырост',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Icon: TrendingUp,
  },
  practice: {
    label: 'Практика',
    className: 'border-neutral-200 bg-neutral-50 text-neutral-700',
    Icon: Clock3,
  },
}

const LEVEL_LABELS: Record<number, string> = {
  1: 'Уровень 1 · база',
  2: 'Уровень 2 · уверенно',
  3: 'Уровень 3 · сложно',
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easier: 'Легче',
  fit: 'В уровень',
  harder: 'Сложнее',
}

const TOPIC_STATUS: Record<string, { label: string; className: string }> = {
  weak: { label: 'Слабо', className: 'bg-amber-50 text-amber-700' },
  developing: { label: 'В процессе', className: 'bg-sky-50 text-sky-700' },
  strong: { label: 'Сильно', className: 'bg-emerald-50 text-emerald-700' },
  review: { label: 'Повторить', className: 'bg-violet-50 text-violet-700' },
  new: { label: 'Новая', className: 'bg-neutral-100 text-neutral-600' },
}

function cleanUUID(value: string): string {
  return value.startsWith('course_') ? value.slice('course_'.length) : value
}

function asCourseUUID(value: string): string {
  return value.startsWith('course_') ? value : `course_${value}`
}

export default function PracticeClient({
  orgslug,
  courseuuid,
}: {
  orgslug: string
  courseuuid: string
}) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const authenticated = session?.status === 'authenticated'
  const courseUUID = asCourseUUID(courseuuid)
  const clean = cleanUUID(courseuuid)

  const feed = useQuery<Feed>({
    queryKey: ['practice', 'today', courseUUID],
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}practice/today?course_uuid=${encodeURIComponent(courseUUID)}&limit=10`,
        token
      ),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  })

  const state = useQuery<PracticeState>({
    queryKey: ['practice', 'state', courseUUID],
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}practice/state?course_uuid=${encodeURIComponent(courseUUID)}`,
        token
      ),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  })

  const summary = state.data?.summary
  const masteryPercent = Math.round((summary?.average_mastery ?? 0) * 100)
  const plannedXp = feed.data?.planned_xp ?? 0

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Link
        href={getUriWithOrg(orgslug, `/course/${clean}`)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-black/50 transition-colors hover:text-black"
      >
        <ArrowLeft size={15} />
        Назад к курсу
      </Link>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">
            Персональная практика
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-black">
            Сегодня
          </h1>
          <p className="mt-1 text-sm text-black/45">
            Задачи подобраны по вашему уровню: слабые темы, повторения и немного
            задач на вырост.
          </p>
        </div>
        {summary && (
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5">
            <Target size={16} className="text-black/45" />
            <span className="text-sm font-bold text-black">
              {plannedXp} / {summary.goal_xp || 40} XP
            </span>
          </div>
        )}
      </div>

      {!authenticated && (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6">
          <p className="text-sm text-black/60">
            Войдите, чтобы получать персональную ленту задач и видеть прогресс по
            темам.
          </p>
          <Link
            href={getUriWithOrg(orgslug, '/login')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white"
          >
            Войти
            <ChevronRight size={15} />
          </Link>
        </div>
      )}

      {authenticated && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard
              label="Средняя освоенность"
              value={`${masteryPercent}%`}
              Icon={TrendingUp}
            />
            <SummaryCard
              label="Темы освоены"
              value={`${summary?.topics_mastered ?? 0} / ${summary?.topics_started ?? 0}`}
              Icon={Target}
            />
            <SummaryCard
              label="Серия"
              value={`${summary?.streak_days ?? 0} дн.`}
              Icon={Flame}
            />
            <SummaryCard
              label="Попыток"
              value={`${summary?.attempts ?? 0}`}
              Icon={Clock3}
            />
          </div>


          {state.data?.assessment && (
            <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-neutral-900 text-white">
                    <span className="text-2xl font-black leading-none">
                      {state.data.assessment.grade}
                    </span>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">
                      Оценка знаний
                    </p>
                    <p className="mt-1 text-lg font-black tracking-tight text-black">
                      {state.data.assessment.level_label} ·{' '}
                      {state.data.assessment.grade_label}
                    </p>
                    <p className="mt-0.5 text-xs text-black/45">
                      {state.data.assessment.score_percent}/100 по{' '}
                      {state.data.assessment.topics_started} изученным темам
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold text-black/55">
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1">
                    Сильных тем: {state.data.assessment.topics_strong}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1">
                    Слабых: {state.data.assessment.topics_weak}
                  </span>
                  {state.data.assessment.due_reviews > 0 && (
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                      Повторить: {state.data.assessment.due_reviews}
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-3 rounded-xl bg-neutral-50 px-3 py-2 text-sm font-semibold text-black/70">
                {state.data.assessment.next_action}
              </p>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-black/40">
                    Что подтянуть
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {state.data.assessment.weaknesses.length === 0 ? (
                      <p className="text-xs text-black/45">Явных провалов нет.</p>
                    ) : (
                      state.data.assessment.weaknesses.map((topic) => (
                        <div
                          key={topic.topic_key}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate font-semibold text-black/70">
                            {topic.topic_name || topic.topic_key}
                          </span>
                          <span className="shrink-0 font-black text-amber-700">
                            {Math.round(topic.mastery * 100)}%
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-black/40">
                    Сильные стороны
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {state.data.assessment.strengths.length === 0 ? (
                      <p className="text-xs text-black/45">
                        Пока не набрано — решите несколько задач уверенно.
                      </p>
                    ) : (
                      state.data.assessment.strengths.map((topic) => (
                        <div
                          key={topic.topic_key}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate font-semibold text-black/70">
                            {topic.topic_name || topic.topic_key}
                          </span>
                          <span className="shrink-0 font-black text-emerald-700">
                            {Math.round(topic.mastery * 100)}%
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {!state.data.assessment.confidence_enough && (
                <p className="mt-3 text-[11px] font-medium text-black/40">
                  Оценка предварительная: нужно больше решённых задач, чтобы она
                  стала устойчивой.
                </p>
              )}
            </div>
          )}
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight text-black">
              Задания на сегодня
            </h2>
            <button
              type="button"
              onClick={() => {
                feed.refetch()
                state.refetch()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-black/60 hover:text-black"
            >
              <RefreshCw size={13} />
              Обновить
            </button>
          </div>

          {feed.isLoading && (
            <div className="mt-3 space-y-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="h-24 animate-pulse rounded-2xl border border-neutral-200 bg-white"
                />
              ))}
            </div>
          )}

          {feed.isError && (
            <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
              Не удалось загрузить ленту: {(feed.error as Error).message}
            </div>
          )}

          {feed.data && feed.data.items.length === 0 && (
            <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-black/55">
              В этом курсе пока нет практических заданий. Как только
              преподаватель добавит задачи с темами и уровнями, лента соберётся
              сама.
            </div>
          )}

          <div className="mt-3 space-y-3">
            {feed.data?.items.map((item) => {
              const reason = REASON_STYLES[item.reason] || REASON_STYLES.practice
              const activity = item.activity_uuid.replace('activity_', '')
              return (
                <Link
                  key={item.task_uuid}
                  href={getUriWithOrg(
                    orgslug,
                    `/course/${clean}/activity/${activity}`
                  )}
                  className="group block rounded-2xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-400 sm:p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${reason.className}`}
                        >
                          <reason.Icon size={11} />
                          {reason.label}
                        </span>
                        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-0.5 text-[11px] font-semibold text-black/55">
                          {LEVEL_LABELS[item.level] || `Уровень ${item.level}`}
                        </span>
                        {item.difficulty && (
                          <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-black/45">
                            {DIFFICULTY_LABELS[item.difficulty]}
                          </span>
                        )}
                        {item.topic_name && (
                          <span className="text-[11px] font-semibold text-black/40">
                            {item.topic_name}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-base font-bold text-black">
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs text-black/45">
                        Освоенность темы: {Math.round(item.mastery * 100)}% ·
                        шанс решения: {Math.round(item.expected_success * 100)}%
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-4">
                      <div className="text-end">
                        <p className="text-sm font-black text-black">
                          +{item.xp} XP
                        </p>
                        <p className="text-[11px] text-black/40">
                          ~{item.estimated_minutes} мин
                        </p>
                      </div>
                      <span className="grid h-9 w-9 place-items-center rounded-full border border-neutral-200 bg-white text-black/50 transition-colors group-hover:border-black group-hover:text-black">
                        <ChevronRight size={17} />
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          {state.data && state.data.topics.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-black tracking-tight text-black">
                Освоенность тем
              </h2>
              <div className="mt-3 space-y-2.5 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
                {state.data.topics.map((topic) => (
                  <div key={topic.topic_key}>
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-semibold text-black/75">
                        {topic.topic_name || topic.topic_key}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                            TOPIC_STATUS[topic.status || 'new']?.className ||
                            TOPIC_STATUS.new.className
                          }`}
                        >
                          {TOPIC_STATUS[topic.status || 'new']?.label ||
                            'Новая'}
                        </span>
                        <span className="font-bold text-black">
                          {Math.round(topic.mastery * 100)}%
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-black transition-all"
                        style={{ width: `${Math.round(topic.mastery * 100)}%` }}
                      />
                    </div>
                    {topic.confidence < 0.5 && topic.attempts > 0 && (
                      <p className="mt-1 text-[10px] font-medium text-black/35">
                        Мало данных — решите ещё несколько задач, чтобы оценка
                        стала точнее.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  Icon,
}: {
  label: string
  value: string
  Icon: React.ElementType
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-black/40">
        <Icon size={13} />
        {label}
      </div>
      <p className="mt-2 text-xl font-black tracking-tight text-black">{value}</p>
    </div>
  )
}
