'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { submitVideoRevision } from '@/lib/video-revision-ui';

export function VideoRevisionPanel({
  parentVideoId,
  comment,
  requirements,
}: {
  parentVideoId: string;
  comment: string | null;
  requirements: string[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await submitVideoRevision(apiFetch, parentVideoId, new FormData(event.currentTarget), router.push);
    } catch (err) {
      setError(err instanceof Error ? err.message : '返修版本上传失败');
      setSubmitting(false);
    }
  }

  return (
    <section className="panel section-gap">
      <h2>上传返修版本</h2>
      <p><strong>主管意见：</strong>{comment || '-'}</p>
      {requirements.length > 0 ? <ul>{requirements.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      <form className="form-grid" onSubmit={onSubmit}>
        <div className="form-field full">
          <label htmlFor="revision-file">新视频文件</label>
          <input id="revision-file" name="file" type="file" accept="video/mp4,video/quicktime,video/webm" required />
        </div>
        <div className="form-field">
          <label htmlFor="revision-title">新标题（选填）</label>
          <input id="revision-title" name="title" maxLength={255} />
        </div>
        <div className="form-field full">
          <label htmlFor="revision-script">新脚本说明（选填）</label>
          <textarea id="revision-script" name="scriptDescription" />
        </div>
        {error ? <p className="error full">{error}</p> : null}
        <div className="form-field full">
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? '上传中' : '上传返修版本'}
          </button>
        </div>
      </form>
    </section>
  );
}
