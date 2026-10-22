import { useRef, useState } from 'react';
import { FileAudio, Play, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useList, useRemove } from '../lib/hooks';
import { useTenant } from '../state/tenant';
import { api, errorMessage, scoped } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { Sound, Voice } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Tabs,
  Textarea,
  useConfirm,
} from '../components/ui';

export function SoundsPage() {
  const list = useList<Sound>('sounds');
  const remove = useRemove('sounds', 'Sound deleted');
  const confirm = useConfirm();
  const { tenantId } = useTenant();
  const [mode, setMode] = useState<'upload' | 'tts'>('upload');

  return (
    <div>
      <PageHeader title="Greetings & sounds" icon={<FileAudio className="size-5" />} description="What callers hear in menus, queues and conference rooms" />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: 'upload', label: 'Upload a file' },
              { value: 'tts', label: 'Text to speech' },
            ]}
          />
          {mode === 'upload' ? <UploadCard /> : <TextToSpeechCard />}
        </div>

        <Card>
          {list.isLoading ? (
            <LoadingBlock />
          ) : list.error ? (
            <ErrorBlock error={list.error} />
          ) : !list.data?.length ? (
            <EmptyState icon={<FileAudio className="size-5" />} title="No sounds yet" description="Record a greeting on your phone and upload it, or type the text and let Envo speak it." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <div className="min-w-40 flex-1">
                    <div className="flex items-center gap-2 font-medium text-slate-900">
                      {s.name}
                      {s.tenant_id === null && <Badge tone="violet">Shared</Badge>}
                      {s.source === 'tts' && (
                        <Badge tone="brand">
                          <Sparkles className="size-3" /> Spoken
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {(s.duration_ms / 1000).toFixed(1)}s · {formatDateTime(s.created_at)}
                    </div>
                  </div>
                  <audio controls preload="none" src={scoped(`/api/sounds/${s.id}/audio`, tenantId)} className="h-9 w-72 max-w-full" />
                  <IconButton
                    label="Delete"
                    tone="danger"
                    onClick={async () => {
                      if (await confirm({ title: `Delete "${s.name}"?`, message: 'IVRs and queues using it will fall back to silence.', confirmLabel: 'Delete', danger: true })) {
                        remove.mutate(s.id);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function UploadCard() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('name', name || file.name.replace(/\.[^.]+$/, ''));
    setBusy(true);
    try {
      await api.post(scoped('/api/sounds', tenantId), body);
      toast.success('Sound uploaded and converted');
      setFile(null);
      setName('');
      if (fileRef.current) fileRef.current.value = '';
      await qc.invalidateQueries({ queryKey: ['list', 'sounds'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Upload a recording" description="MP3, WAV, M4A, OGG… up to 25 MB, converted to telephone quality automatically." />
      <div className="space-y-4 p-5">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40">
          <Upload className="size-6 text-slate-400" />
          <span className="mt-2 text-sm font-medium text-slate-700">{file ? file.name : 'Choose an audio file'}</span>
          <span className="text-xs text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'or drop it here'}</span>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.wma"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </label>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome greeting" />
        </Field>
        <Button variant="primary" className="w-full" loading={busy} disabled={!file} onClick={upload} icon={<Upload className="size-4" />}>
          Upload
        </Button>
      </div>
    </Card>
  );
}

function TextToSpeechCard() {
  const { tenantId } = useTenant();
  const qc = useQueryClient();
  const { data: voices = [], isLoading } = useQuery({ queryKey: ['voices'], queryFn: () => api.get<Voice[]>('/api/sounds/voices'), staleTime: Infinity });
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('');
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const selected = voice || voices[0]?.id || '';

  const payload = () => ({ name: name || undefined, text, voice: selected, speed });

  const preview = async () => {
    setBusy('preview');
    try {
      const res = await fetch('/api/sounds/tts/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
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
      await api.post(scoped('/api/sounds/tts', tenantId), payload());
      toast.success('Greeting created');
      setText('');
      setName('');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      await qc.invalidateQueries({ queryKey: ['list', 'sounds'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Speak a greeting" description="Type the announcement and Envo records it with a neural voice, on this server." />
      <div className="space-y-4 p-5">
        {isLoading ? (
          <LoadingBlock />
        ) : !voices.length ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">No voices are installed on the server yet.</p>
        ) : (
          <>
            <Field label="Text" hint={`${text.length}/1500 characters`}>
              <Textarea
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 1500))}
                placeholder="Thank you for calling Envo. Press 1 for sales, 2 for support, or stay on the line for the operator."
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Voice">
                <Select value={selected} onChange={(e) => setVoice(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Speed">
                <Select value={speed} onChange={(e) => setSpeed(e.target.value as typeof speed)}>
                  <option value="slow">Slow</option>
                  <option value="normal">Normal</option>
                  <option value="fast">Fast</option>
                </Select>
              </Field>
            </div>
            <Field label="Name" hint="Shown when picking greetings">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main menu greeting" />
            </Field>
            {previewUrl && <audio controls autoPlay src={previewUrl} className="h-9 w-full" />}
            <div className="flex gap-2">
              <Button className="flex-1" icon={<Play className="size-4" />} loading={busy === 'preview'} disabled={text.trim().length < 2} onClick={preview}>
                Preview
              </Button>
              <Button variant="primary" className="flex-1" icon={<Sparkles className="size-4" />} loading={busy === 'save'} disabled={text.trim().length < 2} onClick={save}>
                Save sound
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
