'use client'

import React, { useEffect, useState } from 'react'
import { Brain, CheckCircle2, Loader2, Send } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'

type Review = {
  score?: number | null
  verdict?: string
  feedback?: string
  missing?: string[]
}

export default function TaskExplanationReview({
  taskUUID,
  taskTitle,
}: {
  taskUUID: string
  taskTitle: string
}) {
  const session = useLHSession() as
    | { data?: { user?: { id?: number }; tokens?: { access_token?: string } } }
    | null
  const token = session?.data?.tokens?.access_token
  const userId = session?.data?.user?.id || 0
  const storageKey = `zk:explanation:${userId}:${taskUUID}`

  const [explanation, setExplanation] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as { explanation?: string; review?: Review }
        setExplanation(parsed.explanation || '')
        setReview(parsed.review || null)
      }
    } catch {
      /* ignore corrupt local state */
    }
  }, [storageKey])

  async function submit() {
    if (!token || busy || explanation.trim().length < 10) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${getAPIUrl()}assistant/review-explanation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ task_uuid: taskUUID, explanation }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
      const next = (data?.review || {}) as Review
      setReview(next)
      localStorage.setItem(storageKey, JSON.stringify({ explanation, review: next }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось получить ревью')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-indigo-800">
          <Brain size={14} />
          Объясни решение
        </div>
        {review?.score != null && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-indigo-700">
            {review.score}/100
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-indigo-700/70">
        Задача «{taskTitle}»: опиши словами, как и почему твоё решение работает.
        Нейросеть проверит понимание.
      </p>
      <textarea
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        rows={3}
        placeholder="Например: я считываю два числа, считаю гипотенузу по теореме Пифагора и вывожу с точностью 6 знаков…"
        className="mt-2 w-full resize-y rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-indigo-700/50">
          {explanation.trim().length < 10 ? 'минимум 10 символов' : 'можно отправить'}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={busy || explanation.trim().length < 10}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {busy ? 'Проверяю…' : 'Проверить объяснение'}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-rose-700">{error}</p>}
      {review && (
        <div className="mt-2 rounded-lg bg-white px-3 py-2 text-[12px] text-neutral-700">
          <div className="flex items-center gap-1.5 font-semibold text-emerald-700">
            <CheckCircle2 size={13} /> Ревью
          </div>
          <p className="mt-1 whitespace-pre-wrap">{review.feedback}</p>
          {(review.missing || []).length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[11px] text-neutral-500">
              {(review.missing || []).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
