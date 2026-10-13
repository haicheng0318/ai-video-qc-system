import { z } from 'zod';
import { VideoType } from '@prisma/client';

const metric = z.string().regex(/^[a-z][a-zA-Z0-9]{0,99}$/);
const finite = z.number().finite().min(0);
export const benchmarkProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(100),
  brand: z.string().trim().min(1).max(100).nullable().optional(),
  videoType: z.nativeEnum(VideoType),
  primaryMetric: metric,
  requiredMetrics: z.array(metric).min(1).max(30),
  minimumSampleMetric: metric,
  minimumSampleValue: finite,
  observationWindowDays: z.number().int().min(1).max(365),
  guardRules: z.array(z.object({ metric, operator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']), value: finite, capRating: z.enum(['S', 'A+', 'A', 'B', 'B-', 'C', 'D']) }).strict()).max(30),
  thresholds: z.object({
    direction: z.enum(['higher_better', 'lower_better']),
    S: finite, 'A+': finite, A: finite, B: finite, 'B-': finite, C: finite,
  }).strict(),
}).strict();

export const approveBenchmarkSchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
export const manualComprehensiveSchema = z.object({ rating: z.enum(['A', 'B', 'B-', 'C', 'D']), reason: z.string().trim().min(10).max(500) }).strict();
export const confirmComprehensiveSchema = z.object({
  decisionId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
  performanceEligible: z.boolean().optional().default(false),
}).strict();
export const markV11CaseSchema = z.object({ type: z.enum(['excellent', 'negative']), note: z.string().trim().min(1).max(500) }).strict();
