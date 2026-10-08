'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { uploadVideoDirectly, usesDirectVideoUpload } from '@/lib/direct-video-upload';
import { useUnsavedChanges } from '@/lib/unsaved-changes';

const videoTypes = [
  ['product_card', '商品卡视频'],
  ['qianchuan_ad', '千川投放视频'],
  ['live_room_traffic', '直播间引流视频'],
  ['organic', '自然流视频'],
  ['brand_seeding', '品牌种草视频'],
  ['other', '其他'],
];

export default function NewVideoPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [phase, setPhase] = useState('');
  const operationId = useRef(crypto.randomUUID());
  const controller = useRef<AbortController | null>(null);
  const [dirty, setDirty] = useState(false);
  const [options, setOptions] = useState<{ platforms: string[]; videoTypes: string[] } | null>(null);
  useEffect(() => { apiFetch<any>('/api/auth/business-options').then(setOptions).catch(() => {}); }, []);
  useUnsavedChanges(dirty);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    setProgress(null);
    controller.current = new AbortController();

    try {
      const form = new FormData(event.currentTarget);
      const result = usesDirectVideoUpload()
        ? await uploadVideoDirectly(apiFetch, form, '/api/videos/direct', {
          operationId: operationId.current,
          signal: controller.current.signal,
          onProgress: (loaded, total) => setProgress(Math.round((loaded / total) * 100)),
          onPhase: (next) => setPhase(next === 'ticket' ? '正在申请安全上传凭证…' : next === 'uploading' ? '正在上传视频…' : '正在核验并登记视频…'),
        })
        : await apiFetch<{ id: string }>('/api/videos', {
          method: 'POST', headers: { 'Idempotency-Key': operationId.current }, body: form,
          signal: controller.current.signal,
        });
      operationId.current = crypto.randomUUID();
      setDirty(false);
      router.push(`/videos/${result.id}`);
    } catch (err) {
      setError(err instanceof DOMException && err.name === 'AbortError'
        ? '客户端已停止等待上传响应；如服务端已完成登记，视频仍可能出现在列表中，请稍后核对。'
        : err instanceof Error ? err.message : '上传失败');
    } finally {
      setSubmitting(false);
      controller.current = null;
      setPhase('');
    }
  }

  return (
    <main className="page" id="main-content">
      <div className="page-title">
        <h1>上传视频</h1>
      </div>
      <form className="panel form-grid" onSubmit={onSubmit} onChange={() => setDirty(true)}>
        <div className="form-field full">
          <label htmlFor="file">视频文件</label>
          <input id="file" name="file" type="file" accept="video/mp4,video/quicktime,video/webm" required />
          <small className="muted">支持 MP4、MOV、WEBM，最大 500 MB；提交后服务端会再次核验文件类型、大小和内容。</small>
        </div>
        <div className="form-field">
          <label htmlFor="title">视频标题</label>
          <input id="title" name="title" required maxLength={255} />
        </div>
        <div className="form-field">
          <label htmlFor="videoType">视频类型</label>
          <select id="videoType" name="videoType" defaultValue="product_card">
            {videoTypes.filter(([value]) => !options || options.videoTypes.includes(value)).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="brand">品牌</label>
          <input id="brand" name="brand" />
        </div>
        <div className="form-field">
          <label htmlFor="product">产品</label>
          <input id="product" name="product" />
        </div>
        <div className="form-field">
          <label htmlFor="platform">平台</label>
          <input id="platform" name="platform" list="configured-platforms" placeholder="请选择或填写平台" /><datalist id="configured-platforms">{options?.platforms.map(p => <option key={p} value={p} />)}</datalist>
        </div>
        <div className="form-field">
          <label htmlFor="eventName">节点名称</label>
          <input id="eventName" name="eventName" />
        </div>
        <div className="form-field">
          <label>
            <input name="isForAds" type="checkbox" value="true" style={{ width: 'auto', marginRight: 8 }} />
            用于投放
          </label>
        </div>
        <div className="form-field">
          <label>
            <input name="isEventVideo" type="checkbox" value="true" style={{ width: 'auto', marginRight: 8 }} />
            节点视频
          </label>
        </div>
        <div className="form-field full">
          <label htmlFor="scriptDescription">脚本说明</label>
          <textarea id="scriptDescription" name="scriptDescription" />
        </div>
        <div className="form-field full">
          <label htmlFor="relatedRequirement">关联需求</label>
          <textarea id="relatedRequirement" name="relatedRequirement" />
        </div>
        {phase ? <div className="upload-progress full" role="status"><span>{phase}</span>{progress !== null ? <><progress max="100" value={progress}>{progress}%</progress><strong>{progress}%</strong></> : null}</div> : null}
        {error && <p className="error full" role="alert">{error}</p>}
        <div className="form-field full">
          <button className="button" disabled={submitting} type="submit">
            {submitting ? '处理中…' : '提交视频'}
          </button>
          {submitting ? <button className="button secondary" type="button" onClick={() => controller.current?.abort()}>取消上传</button> : null}
        </div>
      </form>
    </main>
  );
}
