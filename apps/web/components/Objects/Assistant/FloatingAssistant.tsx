'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'

type Msg = { role: 'user' | 'assistant'; content: string }
type AssistantAction = { type: string; title?: string }
type AssistantResponse = { reply?: string; actions?: AssistantAction[]; detail?: string }

export default function FloatingAssistant() {
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const session = useLHSession() as
    | { data?: { tokens?: { access_token?: string } } }
    | null
  const token = session?.data?.tokens?.access_token

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      content: 'Привет! Я помогу с курсом: подскажу по задаче, объясню условие или добавлю новую задачу.',
    },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const storageKey = 'lh_ai_assistant_pos'

  const context = useMemo(() => {
    const course = pathname.match(/course\/(course_[0-9a-f-]+)/i)?.[1] || ''
    const assignment = pathname.match(/assignments\/(assignment_[0-9a-f-]+)/i)?.[1] || ''
    const activity = pathname.match(/activity\/(activity_[0-9a-f-]+)/i)?.[1] || ''
    const task =
      searchParams?.get('task') ||
      searchParams?.get('assignment_task_uuid') ||
      searchParams?.get('task_uuid') ||
      ''
    return { page: pathname, course_uuid: course, assignment_uuid: assignment, activity_uuid: activity, task_uuid: task }
  }, [pathname, searchParams])

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey)
    if (!saved) return
    try {
      const value = JSON.parse(saved)
      if (typeof value.x === 'number' && typeof value.y === 'number') {
        setAnchor({
          x: Math.max(8, Math.min(window.innerWidth - 72, value.x)),
          y: Math.max(8, Math.min(window.innerHeight - 72, value.y)),
        })
      }
    } catch {
      window.localStorage.removeItem(storageKey)
    }
  }, [])

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!dragRef.current) return
      const distance = Math.hypot(event.clientX - dragRef.current.startX, event.clientY - dragRef.current.startY)
      if (distance > 4) dragRef.current.moved = true
      setAnchor({
        x: Math.max(8, Math.min(window.innerWidth - 72, event.clientX - dragRef.current.dx)),
        y: Math.max(8, Math.min(window.innerHeight - 72, event.clientY - dragRef.current.dy)),
      })
    }
    const up = () => {
      if (!dragRef.current) return
      if (dragRef.current.moved) {
        suppressClickRef.current = true
        setAnchor((position) => {
          if (position) window.localStorage.setItem(storageKey, JSON.stringify(position))
          return position
        })
      }
      dragRef.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const startDrag = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    suppressClickRef.current = false
    dragRef.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    setAnchor({ x: rect.left, y: rect.top })
  }

  const toggleOpen = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setOpen((value) => !value)
  }

  async function send(text?: string) {
    const value = (text ?? input).trim()
    if (!value || busy || !token) return
    const nextMessages: Msg[] = [...messages, { role: 'user', content: value }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${getAPIUrl()}assistant/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: value,
          history: nextMessages.slice(-12),
          context,
        }),
      })
      const data = (await res.json().catch(() => null)) as AssistantResponse | null
      if (!res.ok) {
        throw new Error(data?.detail || `HTTP ${res.status}`)
      }
      const actionText = (data?.actions || [])
        .filter((a) => a.type === 'task_created')
        .map((a) => `\n\n✅ Создана задача: ${a.title || ''}`)
        .join('')
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: (data?.reply || 'Готово.') + actionText },
      ])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось получить ответ')
    } finally {
      setBusy(false)
    }
  }

  if (!token) return null

  const viewportWidth = typeof window === 'undefined' ? 400 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const panelWidth = Math.min(400, viewportWidth - 20)
  const panelHeight = Math.min(620, viewportHeight * 0.75)
  const panelStyle = anchor
    ? {
        left: Math.max(8, Math.min(viewportWidth - panelWidth - 8, anchor.x - (panelWidth - 56))),
        top: Math.max(8, Math.min(viewportHeight - panelHeight - 8, anchor.y - panelHeight - 12)),
        width: panelWidth,
        height: panelHeight,
      }
    : undefined
  const buttonStyle = anchor ? { left: anchor.x, top: anchor.y } : undefined

  return (
    <>
      {open && (
        <div
          className={`fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl ${
            anchor ? '' : 'bottom-24 right-5 h-[min(620px,75vh)] w-[min(400px,calc(100vw-2.5rem))]'
          }`}
          style={panelStyle}
        >
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <Sparkles size={16} />
              </span>
              <div>
                <p className="text-sm font-bold text-neutral-900">Помощник курса</p>
                <p className="text-[11px] text-neutral-400">контекст текущей страницы</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100" aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'ml-8 bg-neutral-900 text-white'
                    : 'mr-6 bg-neutral-50 text-neutral-800'
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <Loader2 size={13} className="animate-spin" /> думаю…
              </div>
            )}
            {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
          </div>

          <div className="border-t border-neutral-100 p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {['Подскажи по задаче', 'Объясни условие', 'Добавь задачу в курс'].map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={busy}
                  className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
                placeholder="Спроси что-нибудь…"
                className="min-h-[44px] flex-1 resize-none rounded-xl border border-neutral-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
              <button
                onClick={() => send()}
                disabled={busy || !input.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white disabled:opacity-40"
                aria-label="Отправить"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={toggleOpen}
        onMouseDown={startDrag}
        style={buttonStyle}
        className={`fixed z-[70] flex h-14 w-14 touch-none items-center justify-center rounded-full bg-neutral-900 text-white shadow-xl transition hover:scale-105 ${
          anchor ? '' : 'bottom-5 right-5'
        }`}
        aria-label="Помощник курса"
        title="Помощник курса — можно перетащить"
      >
        {open ? <X size={20} /> : <Bot size={22} />}
      </button>
    </>
  )
}
