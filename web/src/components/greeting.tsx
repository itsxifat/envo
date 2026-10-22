import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, Sparkles, Upload } from 'lucide-react';
import { api, errorMessage, scoped } from '../lib/api';
import { useTenant } from '../state/tenant';
import type { Sound, Voice } from '../lib/types';
import { Button, Field, Select, Tabs, Textarea } from './ui';

export function useVoices() {
  return useQuery({ queryKey: ['voices'], queryFn: () => api.get<Voice[]>('/api/sounds/voices'), staleTime: Infinity });
}

/**
 * Makes a greeting on the spot: typed text spoken by a voice on the server, or an uploaded recording.
 * Calls `onCreated` with the new sound so the caller can use it right away (an IVR menu, a queue).
 */
export function GreetingMaker({ onCreated, placeholder, name: defaultName }: { onCreated: (sound: Sound) => void; placeholder?: string; name?: string }) {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const voices = useVoices();
  const canSpeak = (voices.data?.length ?? 0) > 0;
  const [mode, setMode] = useState<'speak' | 'upload'>('speak');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = voice || voices.data?.[0]?.id || '';
  const active = canSpeak ? mode : 'upload';

  const done = async (sound: Sound) => {
    await qc.invalidateQueries({ queryKey: ['list', 'sounds'] });
    onCreated(sound);
  };

  const preview = async () => {
    setBusy('preview');
    try {
      const res = await fetch('/api/sounds/tts/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: selected }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Preview failed');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(await res.blob()));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      if (active === 'speak') {
        const sound = await api.post<Sound>(scoped('/api/sounds/tts', tenantId), { text, voice: selected, name: defaultName || undefined });
        toast.success('Greeting created');
        await done(sound);
      } else if (file) {
        const body = new FormData();
        body.append('file', file);
        body.append('name', defaultName || file.name.replace(/\.[^.]+$/, ''));
        const sound = await api.post<Sound>(scoped('/api/sounds', tenantId), body);
        toast.success('Recording uploaded');
        await done(sound);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {canSpeak && (
        <Tabs
          value={mode}
          onChange={setMode}
          tabs={[
            { value: 'speak', label: 'Type it' },
            { value: 'upload', label: 'Upload a recording' },
          ]}
        />
      )}
      {active === 'speak' ? (
        <>
          <Field hint={`Envo reads it out with a natural voice · ${text.length}/1500`}>
            <Textarea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 1500))}
              placeholder={placeholder ?? 'Thank you for calling. Press 1 for sales, press 2 for support.'}
            />
          </Field>
          {(voices.data?.length ?? 0) > 1 && (
            <Field label="Voice">
              <Select value={selected} onChange={(e) => setVoice(e.target.value)}>
                {voices.data!.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {previewUrl && <audio controls autoPlay src={previewUrl} className="h-9 w-full" />}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Play className="size-4" />} loading={busy === 'preview'} disabled={text.trim().length < 2} onClick={preview}>
              Listen
            </Button>
            <Button size="sm" variant="primary" icon={<Sparkles className="size-4" />} loading={busy === 'save'} disabled={text.trim().length < 2} onClick={save}>
              Use this greeting
            </Button>
          </div>
        </>
      ) : (
        <>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-5 text-center transition hover:border-brand-400 hover:bg-brand-50/40">
            <Upload className="size-5 text-slate-400" />
            <span className="mt-1.5 text-sm font-medium text-slate-700">{file ? file.name : 'Choose an audio file'}</span>
            <span className="text-xs text-slate-500">MP3, WAV, M4A… up to 25 MB</span>
            <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button size="sm" variant="primary" icon={<Upload className="size-4" />} loading={busy === 'save'} disabled={!file} onClick={save}>
            Upload and use
          </Button>
        </>
      )}
    </div>
  );
}
