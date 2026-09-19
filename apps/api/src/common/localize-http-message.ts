const exactMessages: Record<string, string> = {
  'Invalid account or password.': '账号或密码错误。',
  'User is disabled or does not exist.': '账号已停用或不存在。',
  'Insufficient role permission.': '当前角色权限不足。',
  'Platform benchmark not found.': '未找到平台基准。',
  'platform is required.': '请填写平台。',
  'Unsupported benchmark metric.': '不支持该基准指标。',
  'The same platform benchmark already exists.': '相同平台、品牌、视频类型和指标的基准已存在。',
  'Higher-is-better thresholds must satisfy S ≥ A ≥ B ≥ C.': '越高越好的指标必须满足 S ≥ A ≥ B ≥ C。',
  'Lower-is-better thresholds must satisfy S ≤ A ≤ B ≤ C.': '越低越好的指标必须满足 S ≤ A ≤ B ≤ C。',
  'Only MP4, MOV, and WEBM videos are supported.': '仅支持 MP4、MOV 和 WEBM 格式的视频。',
  'Video file is required.': '请选择要上传的视频文件。',
  'Result data has changed. Reload before submitting.': '结果数据已发生变化，请刷新后再提交。',
  'dataStartDate and dataEndDate are required.': '请填写数据开始日期和结束日期。',
  'dataStartDate must be before or equal to dataEndDate.': '数据开始日期不能晚于结束日期。',
  'At least one core metric is required.': '请至少填写一项核心指标。',
};

const statusFallbacks: Record<number, string> = {
  400: '请求参数不符合要求，请检查填写内容。',
  401: '登录状态已失效，请重新登录。',
  403: '当前账号没有执行此操作的权限。',
  404: '未找到请求的资源。',
  409: '当前数据或流程状态已发生变化，请刷新后重试。',
  422: '数据校验失败，请检查数据完整性。',
  429: '操作过于频繁，请稍后重试。',
};

export function localizeHttpMessage(message: unknown, status: number): string {
  if (typeof message !== 'string' || !message.trim()) {
    return statusFallbacks[status] || '请求处理失败，请稍后重试。';
  }
  const trimmed = message.trim();
  if (exactMessages[trimmed]) return exactMessages[trimmed];
  if (/[一-鿿]/.test(trimmed)) return trimmed;
  if (/not found/i.test(trimmed)) return statusFallbacks[404];
  if (/permission|denied|forbidden/i.test(trimmed)) return statusFallbacks[403];
  if (/already running/i.test(trimmed)) return '相同任务正在处理中，请勿重复提交。';
  if (/already|duplicate/i.test(trimmed)) return '该操作已完成或记录已存在，请刷新后查看。';
  if (/status does not allow|only the latest|no longer current/i.test(trimmed)) return statusFallbacks[409];
  return statusFallbacks[status] || '请求处理失败，请稍后重试。';
}
