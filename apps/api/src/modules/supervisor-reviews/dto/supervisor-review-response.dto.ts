import { SupervisorReviewDecision } from './create-supervisor-review.dto';

export class SupervisorReviewResponseDto {
  id: string;
  videoId: string;
  decision: SupervisorReviewDecision;
  comment: string | null;
  revisionRequirements: string[];
  reviewedAt: Date;
  reviewer: {
    id: string;
    name: string;
    account: string;
    role: string;
  };
}
