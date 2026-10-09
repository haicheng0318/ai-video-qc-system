'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
const definitions: Record<string, { title: string; fields: Array<[string, string, string]> }> = {
  site: { title: '站点信息', fields: [['name','站点名称','text'],['notice','公告','text']] },
  video_options: { title: '平台与视频类型选项', fields: [['platforms','平台（逗号分隔）','list'],['videoTypes','允许选择的视频类型','videoTypes']] },
  visitor_defaults: { title: '访客默认授权模板', fields: [['validDays','有效天数','number'],['uploadCount','每日上传次数','number'],['storageBytes','存储字节上限','number'],['contentEvaluations','每月评估次数','number']] },
  retention: { title: '保留复核策略（不会自动删除）', fields: [['temporaryHours','临时文件复核时限（小时）','number'],['auditDays','审计记录保留复核（天）','number']] },
  alerts: { title: '告警阈值', fields: [['workerStaleSeconds','执行进程心跳超时（秒）','number'],['queueWaitSeconds','排队超时（秒）','number'],['expiryWarningDays','账号到期预警（天）','number']] },
  evaluation_parameters: { title: '后续文本评估参数', fields: [['stage','评估阶段','stage'],['modelName','模型名称','text'],['maxOutputTokens','输出 Token 上限','number']] },
  v11_content_shadow: { title: 'V1.1 内容评估灰度', fields: [['enabled','启用 V1.1 内容评估','boolean'],['shadowMode','仅影子运行，不改变正式流程','boolean']] },
  v11_workflow_gates: { title: 'V1.1 人工关卡', fields: [['manualContentReviewEnabled','保留人工内容审核','boolean'],['manualFinalConfirmationEnabled','保留人工最终确认','boolean']] },
};
export function PolicySettings({ data, onSaved, onDirty, onReset }: { data: any; onSaved: (key: string) => void; onDirty: (key: string) => void; onReset: (key: string) => void }) {
  return <>{Object.entries(definitions).map(([key, definition]) => <PolicyForm key={key} settingKey={key} definition={definition} row={data.items.find((i: any) => i.key === key)} defaults={data.defaults?.[key] || (key === 'evaluation_parameters' ? { stage: 'result', modelName: 'qwen3.5-plus', maxOutputTokens: 4000 } : {})} onSaved={onSaved} onDirty={onDirty} onReset={onReset} />)}</>;
}
function PolicyForm({ settingKey, definition, row, defaults, onSaved, onDirty, onReset }: any) {
  const [editing, setEditing] = useState(false); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [base, setBase] = useState({ version: row?.version || 0, value: row?.value || defaults });
  useEffect(() => { if (!editing && (row?.version || 0) > base.version) setBase({ version: row.version, value: row.value }); }, [row, editing, base.version]);
  const initial = base.value;
  return <details><summary>{definition.title} · 草稿基准版本 {base.version || '默认'}</summary>{(row?.version || 0) > base.version && <div role="alert"><p>服务端已有新版本 {row.version}，此项草稿仍基于版本 {base.version}；请查看历史或明确重载，旧版本提交会产生冲突。</p><button type="button" disabled={busy} onClick={() => { if (window.confirm('重载将丢弃此项未保存编辑，确认加载最新版本？')) { setBase({ version: row.version, value: row.value }); setEditing(false); setMessage(''); onReset(settingKey); } }}>重载此项最新版本</button></div>}<form key={base.version} onChange={() => { setEditing(true); onDirty(settingKey); }} onSubmit={async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); const value = Object.fromEntries(definition.fields.map(([key, , type]: string[]) => [key, type === 'videoTypes' ? form.getAll(key) : type === 'boolean' ? form.get(key) === 'on' : type === 'number' ? Number(form.get(key)) : type === 'list' ? String(form.get(key)).split(/[,，]/).map(v => v.trim()).filter(Boolean) : String(form.get(key))]));
    setBusy(true); setMessage(''); try { const saved = await apiFetch<any>(`/api/admin/operations/settings/${settingKey}`, { method: 'PUT', body: JSON.stringify({ value, expectedVersion: base.version, reason: form.get('reason'), confirmed: form.get('confirmed') === 'on' }) }); setBase({ version: saved.version, value: saved.value }); setEditing(false); setMessage('已保存版本，后续操作生效。'); onSaved(settingKey); } catch (err) { setMessage(err instanceof Error ? err.message : '保存失败'); } finally { setBusy(false); }
  }}><fieldset disabled={busy}><p>仅允许白名单字段；不接收密钥、地址或内部请求内容。{editing && '本表单有未保存编辑。'}</p>{definition.fields.map(([key,label,type]: string[]) => <label key={key}>{type === 'boolean' ? <><input name={key} type="checkbox" defaultChecked={Boolean(initial[key])} />{label}</> : <>{label}{type === 'videoTypes' ? <span>{[['product_card','商品卡视频'],['qianchuan_ad','千川投放视频'],['live_room_traffic','直播间引流视频'],['organic','自然流视频'],['brand_seeding','品牌种草视频'],['other','其他']].map(([value,label]) => <span key={value}><input aria-label={label} type="checkbox" name={key} value={value} defaultChecked={initial[key]?.includes(value)} />{label} </span>)}</span> : type === 'stage' ? <select name={key} defaultValue={initial[key]}><option value="result">数据复盘</option><option value="final">最终建议</option></select> : <input name={key} type={type === 'number' ? 'number' : 'text'} defaultValue={Array.isArray(initial[key]) ? initial[key].join(',') : initial[key]} required={key !== 'notice'} maxLength={1000} />}</>}</label>)}<label>操作原因<input name="reason" required maxLength={500} /></label><label><input name="confirmed" type="checkbox" required />确认更新该策略版本</label><button disabled={busy}>保存策略版本</button>{message && <p role="status">{message}</p>}</fieldset></form></details>;
}
