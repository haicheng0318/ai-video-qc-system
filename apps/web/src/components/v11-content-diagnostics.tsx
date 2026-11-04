import * as React from 'react';
import type { V11ContentDiagnostics as Diagnostics } from '@ai-video-qc/shared';

const labels: Record<string, string> = {
  opening_hook: '前3秒吸引力', selling_point: '卖点表达', structure: '内容结构', visual_quality: '画面质量',
  pacing: '节奏', subtitle_audio: '字幕/声音', platform_fit: '平台适配', action_logic: '行动逻辑',
};

export function V11ContentDiagnostics({ diagnostics }: { diagnostics: Diagnostics }) {
  return <section className="section-gap" aria-label="编导内容诊断">
    <h3>编导总结</h3>
    <p className="muted">诊断说明来自采纳结果对应的代表评估。</p>
    <div className="diagnostic-summary">
      <section><h4>相对优势维度</h4>{diagnostics.directorSummary.strengths.map(item => <p key={item.dimension}><strong>{labels[item.dimension] || item.dimension}</strong> · {item.observation || '该历史结果没有可用的观察说明。'}</p>)}</section>
      <section><h4>建议处理顺序</h4>{diagnostics.directorSummary.priorities.length ? diagnostics.directorSummary.priorities.map((item, index) => <p key={item.dimension}><strong>第 {index + 1} 项 · {labels[item.dimension] || item.dimension}</strong><br />{item.improvementSuggestions?.[0]}</p>) : <p>{diagnostics.directorSummary.stableMessage}</p>}</section>
    </div>
    <h3 className="section-gap">8 维诊断</h3>
    <div className="diagnostic-grid">{diagnostics.dimensions.map(item => <article className="panel diagnostic-card" key={item.dimension}>
      <header><div><h4>{labels[item.dimension] || item.dimension}</h4><small>{item.status}</small></div><strong>{item.score === null ? '无法判断' : `${Number.isInteger(item.score) ? item.score : item.score.toFixed(1)} / ${item.weight} 分`}</strong></header>
      <p>{item.observation || '该维度没有可用的代表评估观察内容。'}</p>
      <h5>关键事实</h5>{item.facts.length ? <ul>{item.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul> : <p className="muted">未记录关键事实。</p>}
      <h5>证据</h5>{item.evidence.length ? <ul>{item.evidence.map((evidence, index) => <li key={index}>{evidence.startSeconds === null ? '' : `${evidence.startSeconds.toFixed(1)}s`}{evidence.endSeconds === null ? '' : `–${evidence.endSeconds.toFixed(1)}s`} {evidence.description}</li>)}</ul> : <p className="muted">未记录可展示证据。</p>}
      <h5>修改建议</h5>{item.improvementSuggestions === null ? <p className="muted">该历史评估版本未生成修改建议</p> : item.improvementSuggestions.length ? <ul>{item.improvementSuggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}</ul> : <p className="muted">当前维度没有明确的修改建议。</p>}
    </article>)}</div>
  </section>;
}
