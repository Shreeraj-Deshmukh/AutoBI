import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Sparkles, X } from 'lucide-react';
import { Button, cx } from './ui';
import { useAI } from '@/agents/llm';
import { describeMockups } from '@/agents/mockupAgent';
import { ACCEPTED, MAX_FILE_BYTES, MAX_IMAGES, encodeForAI, isImageFile, thumbnail } from '@/lib/images';
import { useStore } from '@/store/store';
import { uid } from '@/lib/util';

interface Shot {
  id: string;
  file: File;
  thumb: string;
}

/**
 * Screenshots or mockups of a dashboard → requirement text (see agents/mockupAgent.ts).
 * The images stay in this page's memory: they are not saved with the project, and are sent
 * only when "Describe screenshots" is clicked. The text is handed to `onText` for the user to edit.
 */
export default function MockupUpload({ onText }: { onText: (text: string) => void }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const aiOn = useAI((s) => s.status === 'ready' && s.enabled);
  const toast = useStore((s) => s.toast);

  const add = async (files: File[]) => {
    const images = files.filter(isImageFile);
    if (files.length && !images.length) return toast('error', 'Add PNG, JPEG or WebP images.');
    const room = MAX_IMAGES - shots.length;
    if (images.length > room) toast('info', `Up to ${MAX_IMAGES} screenshots: ${room > 0 ? `the first ${room} were added` : 'remove one first'}.`);
    const added: Shot[] = [];
    for (const file of images.slice(0, Math.max(0, room))) {
      if (file.size > MAX_FILE_BYTES) {
        toast('error', `${file.name} is larger than 20 MB.`);
        continue;
      }
      try {
        added.push({ id: uid('shot'), file, thumb: await thumbnail(file) });
      } catch {
        toast('error', `${file.name || 'The image'} could not be read.`);
      }
    }
    if (added.length) setShots((s) => [...s, ...added].slice(0, MAX_IMAGES));
  };

  // a screenshot pasted anywhere on the page (Ctrl+V). Text pastes are left alone, including
  // cells copied from Excel or Word, which carry text and a picture of it
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.types.includes('text/plain')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      if (!files.length) return;
      e.preventDefault();
      void addRef.current(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `Pasted screenshot ${i + 1}.png`, { type: f.type }))));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const describe = async () => {
    setBusy(true);
    try {
      const draft = await describeMockups(await encodeForAI(shots.map((s) => s.file)));
      onText(draft.text);
      const extra = [draft.changed.length && `${draft.changed.length} shown differently`, draft.notBuilt.length && `${draft.notBuilt.length} not built`].filter(Boolean).join(', ');
      toast('success', `Described ${draft.pages} page${draft.pages === 1 ? '' : 's'} and ${draft.visuals} visual${draft.visuals === 1 ? '' : 's'}${extra ? ` (${extra}; listed in the text)` : ''}. Check the text before creating the project.`);
    } catch (e) {
      const msg = (e as Error).message;
      toast('error', /image|vision|multimodal|content type/i.test(msg) && /400|not support|invalid/i.test(msg) ? `The connected AI model could not read the images: ${msg}` : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cx('mt-3 rounded-lg border border-dashed p-3 transition-colors', over ? 'border-brand-400 bg-brand-50/50' : 'border-slate-300')}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void add([...e.dataTransfer.files]);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => input.current?.click()} disabled={busy || shots.length >= MAX_IMAGES}>
          Add screenshots
        </Button>
        <input ref={input} type="file" accept={ACCEPTED} multiple hidden aria-label="Screenshot files" data-testid="mockup-input" onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ''; }} />
        {shots.length > 0 && (
          <Button size="sm" variant="primary" icon={<Sparkles className="h-3.5 w-3.5" />} loading={busy} disabled={!aiOn} onClick={describe} title={aiOn ? 'The AI model describes the screenshots as a requirement' : 'Needs the AI model (see AI Model)'}>
            {busy ? 'Reading screenshots…' : 'Describe screenshots'}
          </Button>
        )}
        <span className="text-xs text-slate-500">
          {shots.length === 0
            ? 'Iterating on an existing dashboard or a mockup? Add, paste or drop screenshots, one page each (up to 5).'
            : !aiOn
              ? 'Describing screenshots needs the AI model, which is not connected.'
              : 'The description is added to the text above, for you to check and edit.'}
        </span>
      </div>
      {shots.length > 0 && (
        <>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Screenshots">
            {shots.map((s, i) => (
              <li key={s.id} className="group relative">
                <img src={s.thumb} alt={`Screenshot ${i + 1}: ${s.file.name}`} title={s.file.name} className="h-16 w-24 rounded-md border border-slate-200 bg-slate-50 object-cover object-top" />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-navy-900/75 px-1 text-[0.625rem] text-white">Page {i + 1}</span>
                <button type="button" onClick={() => setShots((xs) => xs.filter((x) => x.id !== s.id))} disabled={busy} aria-label={`Remove screenshot ${i + 1}`} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-red-600">
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-slate-400">
            Screenshots are sent once to the connected AI model to be described, and are not saved. Figures on them are not copied into the text, but avoid screenshots with patient-level details.
          </p>
        </>
      )}
    </div>
  );
}
