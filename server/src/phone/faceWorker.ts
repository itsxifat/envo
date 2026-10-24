import { parentPort } from 'node:worker_threads';

/*
 * The face worker: a thread of its own (bundled to faces/worker.mjs) so a check never holds up the
 * API, and its memory goes back when the thread ends. faces.ts sends it pictures one message each.
 */

// TensorFlow greets the log when it loads, and this thread's console is the server's.
console.log = console.info = console.warn = () => undefined;
const { facesIn } = await import('./faceEngine.js');

parentPort!.on('message', (m: { id: number; image: Uint8Array }) => {
  facesIn(Buffer.from(m.image.buffer, m.image.byteOffset, m.image.byteLength)).then(
    (faces) => parentPort!.postMessage({ id: m.id, faces }),
    (err: unknown) => parentPort!.postMessage({ id: m.id, error: (err as Error)?.message ?? String(err) }),
  );
});
