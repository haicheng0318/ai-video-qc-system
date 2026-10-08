import React from 'react';
import { operationLogActionLabels } from '../../lib/display-labels';

const labels: Record<string, string> = { collected: '已采集', pending: '待采集', rate_limit: '请求限流', configuration: '配置异常', timeout: '请求超时', parsing: '结构解析失败', source_changed: '输入来源已变化', storage: '存储异常', refusal: '模型拒绝', provider_or_execution: '服务或执行异常', content_review: '内容评估', result_review: '数据复盘', final_evaluation: '最终建议', management_access_denied: '管理权限拒绝', login_success: '登录成功', login_failed: '登录失败', admin_usage_export: '用量导出', admin_logs_export: '日志导出', admin_setting_updated: '配置更新', success: '成功', failure: '失败', denied: '拒绝', formal: '正式', trial: '试用',  not_connected: '未接入', unknown: '未知', not_probed: '未诊断', manual_only_not_executed: '人工诊断（尚未执行）', observed_recently: '近期有心跳', stale: '心跳超时', alive: '运行中', available: '可用', unavailable: '不可用', queued: '排队中', running: '执行中', retry_wait: '等待重试', failed: '失败', needs_attention: '需人工处理', uncertain: '结果未知', succeeded: '已完成', started: '已发起', content: '内容评估', result: '数据复盘', final: '最终建议', cleaned: '已清理', cleanup_failed: '清理失败', uploading: '上传中', uploaded: '待清理', collection_since_migration_only: '仅含采集启用后的调用', unknown_before_collection: '采集启用前未知', aliyun_bailian: '阿里云百炼', setting: '系统设置', benchmark: '业务基准' };
export function runtimeValue(value: unknown): string {
  if (value === null || value === undefined) return '未知';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return '详见记录';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return new Date(text).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  return labels[text] || operationLogActionLabels[text] || ({ admin_evaluation_retry: '管理员受控重试', expired: '已过期', cancelled: '已取消', logout: '退出登录', sessions_revoked: '撤销会话', password_changed: '修改密码', password_reset: '重置密码', management_route: '管理入口', runtime_setting: '运行设置', ai_usage: '模型用量', security_events: '安全事件', operation_logs: '操作日志' } as Record<string, string>)[text] || text;
}
export function RuntimeFacts({ values }: { values: Record<string, unknown> }) {
  return <dl className="runtime-facts">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{runtimeValue(value)}</dd></div>)}</dl>;
}
export function RuntimeTable({ rows, columns, action }: { rows: Array<Record<string, any>>; columns: Array<[string, string]>; action?: (row: Record<string, any>) => React.ReactNode }) {
  if (!rows.length) return <p className="muted">当前条件下暂无记录。</p>;
  return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}{action && <th>操作</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map(([key]) => <td key={key}>{runtimeValue(row[key])}</td>)}{action && <td>{action(row)}</td>}</tr>)}</tbody></table></div>;
}
