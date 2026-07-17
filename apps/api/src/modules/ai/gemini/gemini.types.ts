import { VideoType } from '@prisma/client';

export type ContentGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export type ReviewSeverity = 'high' | 'medium' | 'low';

export type ContentReviewPromptInput = {
  platform?: string | null;
  videoType: VideoType | string;
  brand?: string | null;
  product?: string | null;
  isForAds: boolean;
  isEventVideo: boolean;
  eventName?: string | null;
  scriptDescription?: string | null;
  relatedRequirement?: string | null;
};

export type GeminiFileReference = {
  name: string;
  uri: string;
  mimeType: string;
};

export type GeminiAnalysisResult = {
  rawResponse: string;
};
