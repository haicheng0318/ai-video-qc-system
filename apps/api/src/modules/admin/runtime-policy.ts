import { z } from 'zod';
import { VideoType } from '@prisma/client';
const safeText = z.string().trim().max(300).regex(/^[^<>]*$/);
const model = z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/);
export const settingSchemas: Record<string, z.ZodType> = {
  business_notice: z.object({ text: safeText }).strict(),
  cost_rates: z.object({ provider: z.literal('aliyun_bailian'), modelName: model, currency: z.enum(['CNY', 'USD']), inputPerMillion: z.number().min(0).max(100000), outputPerMillion: z.number().min(0).max(100000) }).strict(),
  site: z.object({ name: safeText.min(1).max(80), notice: safeText }).strict(),
  video_options: z.object({ platforms: z.array(safeText.min(1).max(80)).min(1).max(30), videoTypes: z.array(z.enum(VideoType)).min(1).max(6) }).strict(),
  visitor_defaults: z.object({ validDays: z.number().int().min(1).max(365), uploadCount: z.number().int().min(0).max(10000), storageBytes: z.number().int().min(0).max(107374182400), contentEvaluations: z.number().int().min(0).max(10000) }).strict(),
  retention: z.object({ temporaryHours: z.number().int().min(1).max(720), auditDays: z.number().int().min(90).max(3650) }).strict(),
  alerts: z.object({ workerStaleSeconds: z.number().int().min(60).max(600), queueWaitSeconds: z.number().int().min(30).max(86400), expiryWarningDays: z.number().int().min(1).max(90) }).strict(),
  evaluation_parameters: z.object({ stage: z.enum(['result', 'final']), modelName: model, maxOutputTokens: z.number().int().min(256).max(16000) }).strict(),
  v11_content_shadow: z.object({ enabled: z.boolean(), shadowMode: z.boolean() }).strict(),
  v11_workflow_gates: z.object({ manualContentReviewEnabled: z.boolean(), manualFinalConfirmationEnabled: z.boolean() }).strict(),
};
export const settingDefaults = {
  site: { name: 'AI短视频质检', notice: '' },
  video_options: { platforms: ['抖音', '小红书', '视频号'], videoTypes: Object.values(VideoType) },
  visitor_defaults: { validDays: 7, uploadCount: 5, storageBytes: 1073741824, contentEvaluations: 3 },
  retention: { temporaryHours: 24, auditDays: 365 },
  alerts: { workerStaleSeconds: 120, queueWaitSeconds: 600, expiryWarningDays: 7 },
  v11_content_shadow: { enabled: false, shadowMode: true },
  v11_workflow_gates: { manualContentReviewEnabled: true, manualFinalConfirmationEnabled: true },
};
export async function readPolicy<K extends keyof typeof settingDefaults>(db: any, key: K): Promise<typeof settingDefaults[K]> {
  const row = await db.runtimeSetting.findUnique({ where: { key } });
  const result = settingSchemas[key].safeParse(row?.value);
  return result.success ? result.data as typeof settingDefaults[K] : settingDefaults[key];
}
