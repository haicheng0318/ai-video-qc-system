type ApiRequest = (path: string, init?: RequestInit) => Promise<unknown>;

type UploadTicket = {
  ticketId: string;
  uploadUrl: string;
  objectPath: string;
  headers: Record<string, string>;
};

export type UploadOptions = {
  operationId: string;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
  onPhase?: (phase: 'ticket' | 'uploading' | 'confirming') => void;
};

function requiredVideoFile(formData: FormData) {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size < 1) throw new Error('请选择视频文件。');
  return file;
}

function formDataPayload(formData: FormData) {
  const payload: Record<string, FormDataEntryValue | boolean> = {};
  for (const [key, value] of formData.entries()) {
    if (key !== 'file') payload[key] = value;
  }
  payload.isForAds = formData.has('isForAds');
  payload.isEventVideo = formData.has('isEventVideo');
  return payload;
}

export function usesDirectVideoUpload() {
  return process.env.NEXT_PUBLIC_VIDEO_UPLOAD_MODE === 'direct';
}

export async function validateVideoFile(file: File) {
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) throw new Error('仅支持 MP4、MOV 和 WEBM 视频。');
  if (file.size < 1 || file.size > 500 * 1024 * 1024) throw new Error('视频大小必须在 1 字节到 500 MB 之间。');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isIsoMedia = bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  const isWebm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (!isIsoMedia && !isWebm) throw new Error('文件内容不像受支持的视频，请重新选择原始视频文件。');
}

function putWithProgress(ticket: UploadTicket, file: File, options: UploadOptions) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open('PUT', ticket.uploadUrl);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) options.onProgress?.(event.loaded, event.total); };
    xhr.onload = () => { options.signal?.removeEventListener('abort', abort); xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`视频上传到存储服务失败（${xhr.status}）。`)); };
    xhr.onerror = () => { options.signal?.removeEventListener('abort', abort); reject(new Error('视频上传网络中断，请保持页面并重试。')); };
    xhr.onabort = () => { options.signal?.removeEventListener('abort', abort); reject(new DOMException('上传已取消', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort(); else xhr.send(file);
  });
}

export async function uploadVideoDirectly(
  request: ApiRequest,
  formData: FormData,
  finalizePath: string,
  options: UploadOptions = { operationId: crypto.randomUUID() },
): Promise<{ id: string }> {
  const file = requiredVideoFile(formData);
  await validateVideoFile(file);
  options.onPhase?.('ticket');
  const ticket = await request('/api/videos/direct-upload-ticket', {
    method: 'POST',
    headers: { 'Idempotency-Key': options.operationId },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSizeBytes: file.size }),
  }) as UploadTicket;

  try {
    options.onPhase?.('uploading');
    await putWithProgress(ticket, file, options);
  } catch (error) {
    if (options.signal?.aborted) await request(`/api/videos/direct-upload-tickets/${ticket.ticketId}/cancel`, { method: 'POST', body: JSON.stringify({}) }).catch(() => undefined);
    throw error;
  }

  options.onPhase?.('confirming');
  return request(finalizePath, {
    method: 'POST',
    headers: { 'Idempotency-Key': options.operationId },
    body: JSON.stringify({
      ...formDataPayload(formData),
      objectPath: ticket.objectPath,
      originalFileName: file.name,
      mimeType: file.type,
      fileSizeBytes: file.size,
    }),
  }) as Promise<{ id: string }>;
}
