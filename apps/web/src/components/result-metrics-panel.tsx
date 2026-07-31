'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  getResultMetricFieldConfig,
  resultMetricFieldDefinitions,
  ResultMetricField,
  VideoType,
} from '@ai-video-qc/shared';
import { apiFetch, ApiUser } from '@/lib/api';
import {
  buildResultMetricPayload,
  canSubmitResultMetrics,
  changedMetricFields,
  createMetricFormValues,
  formatMetricValue,
  loadResultMetricRequests,
  ResultMetricHistory,
  resultMetricErrorMessage,
  ResultMetricSnapshot,
  submitResultMetricSnapshot,
} from '@/lib/result-metrics-ui';

const videoTypeLabels: Record<VideoType, string> = {
  product_card: '商品卡视频',
  qianchuan_ad: '千川投放视频',
  live_room_traffic: '直播间引流视频',
  organic: '自然流视频',
  brand_seeding: '品牌种草视频',
  other: '其他视频',
};

function inputProps(field: ResultMetricField) {
  const kind = resultMetricFieldDefinitions[field].kind;
  if (kind === 'date') return { type: 'date' };
  if (kind === 'url') return { type: 'url' };
  if (kind === 'count') return { type: 'number', min: 0, step: 1 };
  if (kind === 'money2') return { type: 'number', min: 0, step: 0.01 };
  if (['decimal4', 'percentage', 'roi'].includes(kind)) {
    return { type: 'number', min: 0, step: 0.0001, max: kind === 'percentage' ? 100 : undefined };
  }
  return { type: 'text' };
}

export function ResultMetricsPanel({
  videoId,
  videoType,
  isForAds,
  videoStatus,
  currentUser,
  onVideoRefresh,
}: {
  videoId: string;
  videoType: VideoType;
  isForAds: boolean;
  videoStatus: string;
  currentUser: ApiUser | null;
  onVideoRefresh: () => Promise<void>;
}) {
  const config = useMemo(
    () => getResultMetricFieldConfig(videoType, isForAds),
    [videoType, isForAds],
  );
  const [latest, setLatest] = useState<ResultMetricSnapshot | null>(null);
  const [history, setHistory] = useState<ResultMetricHistory>({ items: [], nextCursor: null });
  const [values, setValues] = useState<Record<ResultMetricField, string>>(
    () => createMetricFormValues(config.fields, null),
  );
  const [latestError, setLatestError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLatestError('');
    setHistoryError('');
    await loadResultMetricRequests({
      loadLatest: () => apiFetch(`/api/videos/${videoId}/result-metrics/latest`),
      loadHistory: () => apiFetch(`/api/videos/${videoId}/result-metrics/history?limit=20`),
      onLatest: (snapshot) => {
        setLatest(snapshot);
        setValues(createMetricFormValues(config.fields, snapshot));
      },
      onHistory: setHistory,
      onLatestError: () => setLatestError('最新结果数据暂时不可用。'),
      onHistoryError: () => setHistoryError('历史数据暂时不可用。'),
    });
  }, [config.fields, videoId]);

  useEffect(() => {
    load().catch(() => setLatestError('结果数据暂时不可用。'));
  }, [load]);

  const canEdit = canSubmitResultMetrics(currentUser, videoType, isForAds, videoStatus);
  const payload = buildResultMetricPayload(config.fields, values, latest);
  const changedFields = changedMetricFields(payload);
  const groupedFields = Object.entries(
    config.fields.reduce<Record<string, ResultMetricField[]>>((groups, field) => {
      const group = resultMetricFieldDefinitions[field].group;
      (groups[group] ||= []).push(field);
      return groups;
    }, {}),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changedFields.length === 0) {
      setSubmitError('请至少修改一个字段。');
      return;
    }
    if (!window.confirm(`确认提交 ${changedFields.length} 个字段变更并创建新快照？`)) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await submitResultMetricSnapshot(
        apiFetch,
        videoId,
        payload,
        load,
        onVideoRefresh,
      );
    } catch (error) {
      setSubmitError(resultMetricErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel section-gap result-metrics">
      <div className="page-title">
        <div>
          <h2>运营/投放结果数据</h2>
          <p className="muted">
            {videoTypeLabels[videoType]} · {config.responsibleRole === 'operator' ? '运营主责' : '投放主责'}
          </p>
        </div>
        <span className="status">{latest ? '已有数据快照' : '尚未补充'}</span>
      </div>

      {latestError ? <p className="error">{latestError}</p> : null}
      {latest ? (
        <div className="metric-summary">
          <p>
            数据周期：{latest.dataStartDate || '-'} 至 {latest.dataEndDate || '-'}
          </p>
          <p>
            提交人：{latest.submittedBy?.name || '-'} · {new Date(latest.createdAt).toLocaleString()}
          </p>
          {latest.dataWarnings.length > 0 ? (
            <ul className="warning-list">
              {latest.dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={submit}>
          {groupedFields.map(([group, fields]) => (
            <fieldset className="metric-group" key={group}>
              <legend>{group}</legend>
              <div className="form-grid">
                {fields.map((field) => {
                  const definition = resultMetricFieldDefinitions[field];
                  const suffix = definition.kind === 'percentage'
                    ? '%'
                    : definition.kind === 'roi'
                      ? '倍'
                      : definition.kind === 'money2'
                        ? '元'
                        : '';
                  return (
                    <div className="form-field" key={field}>
                      <label htmlFor={`metric-${field}`}>
                        {definition.label}{suffix ? `（${suffix}）` : ''}
                      </label>
                      {['operatorNote', 'deliveryNote', 'commentKeywords'].includes(field) ? (
                        <textarea
                          id={`metric-${field}`}
                          value={values[field] || ''}
                          onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                          maxLength={field === 'commentKeywords' ? 2000 : 4000}
                        />
                      ) : (
                        <input
                          id={`metric-${field}`}
                          {...inputProps(field)}
                          value={values[field] || ''}
                          onChange={(event) => setValues({ ...values, [field]: event.target.value })}
                          required={field === 'dataStartDate' || field === 'dataEndDate'}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="change-preview">
            <strong>本次变更：</strong>
            {changedFields.length > 0
              ? changedFields.map((field) => resultMetricFieldDefinitions[field as ResultMetricField].label).join('、')
              : '暂无变更'}
          </div>
          {submitError ? <p className="error">{submitError}</p> : null}
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? '提交中' : '保存新数据快照'}
          </button>
        </form>
      ) : (
        <p className="muted">当前角色或视频状态为只读。</p>
      )}

      <h3>历史快照</h3>
      {historyError ? <p className="error">{historyError}</p> : null}
      {history.items.length === 0 ? (
        <p className="muted">暂无历史数据。</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>数据周期</th>
                <th>核心指标</th>
                <th>提交人</th>
                <th>提交时间</th>
              </tr>
            </thead>
            <tbody>
              {history.items.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td>
                    {snapshot.dataStartDate || '-'} 至 {snapshot.dataEndDate || '-'}
                    {snapshot.isLatest ? <span className="status">最新</span> : null}
                  </td>
                  <td>
                    {config.coreFields
                      .filter((field) => snapshot[field] !== null && snapshot[field] !== undefined)
                      .map((field) => `${resultMetricFieldDefinitions[field].label} ${formatMetricValue(field, snapshot[field])}`)
                      .join('；') || '-'}
                  </td>
                  <td>{snapshot.submittedBy?.name || '-'}</td>
                  <td>{new Date(snapshot.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {latest ? <p className="muted">数据已补充，等待后续数据复盘。</p> : null}
    </section>
  );
}
