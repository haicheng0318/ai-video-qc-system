'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function DetailSummary({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById('v11-detail-summary'));
  }, []);

  return target ? createPortal(children, target) : null;
}
