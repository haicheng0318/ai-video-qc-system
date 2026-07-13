import { Injectable } from '@nestjs/common';

export type RuleEngineBoundaryInput = {
  contentGrade?: string | null;
  dataGrade?: string | null;
  dataSufficiency?: string | null;
};

@Injectable()
export class RuleEngineService {
  isExecutionEnabled() {
    return false;
  }

  // Formal rule execution is intentionally reserved for phase 6.
  previewBoundary(_input: RuleEngineBoundaryInput) {
    return {
      phase: 'reserved',
      enabled: false,
    };
  }
}
