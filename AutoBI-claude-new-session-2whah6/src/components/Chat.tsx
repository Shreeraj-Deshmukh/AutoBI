import { useEffect, useRef, useState } from 'react';
import { Send, Bot, User } from 'lucide-react';
import type { ChatMessage } from '@/types';
import { cx } from './ui';
import { useAI } from '@/agents/llm';

export default function Chat({ messages, onSend, onOption, placeholder, busy, suggestions, title }: { messages: ChatMessage[]; onSend: (t: string) => void; onOption?: (m: ChatMessage, o: string) => void; placeholder: string; busy?: boolean; suggestions?: string[]; title: string }) {
  const [text, setText] = useState('');
  const ai = useAI();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  const lastAgent = [...messages].reverse().find((m) => m.role === 'agent');
  const send = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <div className="card flex h-[28.75rem] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Bot className="h-4 w-4 text-brand-600" />
        <div className="text-sm font-semibold text-navy-900">{title}</div>
        <span className="ml-auto text-[0.625rem] text-slate-400">{ai.status === 'ready' && ai.enabled ? `Azure AI · ${ai.model}` : 'deterministic engine'}</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-3 py-3">
        {messages.map((m) => (
          <div key={m.id} className={cx('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
            <div className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', m.role === 'agent' ? 'bg-navy-800 text-white' : 'bg-brand-100 text-brand-700')}>
              {m.role === 'agent' ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
            </div>
            <div className={cx('max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[0.8125rem] leading-relaxed', m.role === 'agent' ? 'border border-slate-200 bg-white text-slate-700' : 'bg-brand-600 text-white')}>
              {m.text}
              {m.options && m === lastAgent && onOption && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.options.map((o) => (
                    <button key={o} onClick={() => onOption(m, o)} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[0.6875rem] font-medium text-brand-700 hover:bg-brand-100">
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="pulse-dot h-2 w-2 rounded-full bg-brand-500" /> Agent is working…
          </div>
        )}
        <div ref={end} />
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2">
          {suggestions.map((s) => (
            <button key={s} onClick={() => onSend(s)} className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-[0.6875rem] text-slate-600 hover:bg-slate-200">
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 border-t border-slate-100 p-2">
        <textarea
          className="input min-h-[2.5rem] resize-none overflow-hidden py-2"
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Message"
        />
        <button onClick={send} disabled={busy || !text.trim()} className="rounded-lg bg-navy-800 px-3 text-white hover:bg-navy-700 disabled:opacity-40" aria-label="Send">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
