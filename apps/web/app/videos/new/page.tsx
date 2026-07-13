'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const form = new FormData(event.currentTarget);
      const result = await apiFetch<{ id: string }>('/api/videos', {
        method: 'POST',
        body: form,
      });
      router.push(`/videos/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="page-title">
        <h1>上传视频</h1>
      </div>
      <form className="panel form-grid" onSubmit={onSubmit}>
        <div className="form-field full">
          <label htmlFor="file">视频文件</label>
          <input id="file" name="file" type="file" accept="video/mp4,video/quicktime,video/webm" required />
        </div>
        <div className="form-field">
          <label htmlFor="title">视频标题</label>
          <input id="title" name="title" required maxLength={255} />
        </div>
        <div className="form-field">
          <label htmlFor="videoType">视频类型</label>
          <select id="videoType" name="videoType" defaultValue="product_card">
            {videoTypes.map(([value, label]) => (
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
          <input id="platform" name="platform" placeholder="抖音 / 小红书 / 视频号" />
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
        {error && <p className="error full">{error}</p>}
        <div className="form-field full">
          <button className="button" disabled={submitting} type="submit">
            {submitting ? '上传中' : '提交视频'}
          </button>
        </div>
      </form>
    </main>
  );
}
