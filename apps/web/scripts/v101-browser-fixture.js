// Local-only Playwright CLI fixture. No production credentials or model calls.
async (page) => {
  if (!page.url().startsWith('http://127.0.0.1:3107/')) throw new Error('Local preview required');
  await page.unroute('**/api/**');
  await page.goto('http://127.0.0.1:3107/login');
  const media = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 320;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    return new Promise((resolve) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
      };
      recorder.start();
      context.fillStyle = '#6d59bd'; context.fillRect(0, 0, 180, 320);
      setTimeout(() => { context.fillStyle = '#a194d8'; context.fillRect(20, 20, 140, 280); }, 100);
      setTimeout(() => recorder.stop(), 300);
    });
  });
  const id = '00000000-0000-4000-8000-000000000001';
  const reviewId = '00000000-0000-4000-8000-000000000002';
  const user = { id: 'director', account: 'preview', name: '本地验收用户', role: 'director' };
  let state = 'submitted';
  let polls = 0;
  let triggers = 0;
  const review = () => state === 'submitted' ? null : {
    id: reviewId, status: state === 'ai_content_reviewing' ? 'running' : 'succeeded',
    modelProvider: 'fixture', modelName: 'mock', contentSummary: '浏览器验收：结果已自动更新',
    contentGrade: 'A', totalScore: 86, isPublishableRecommendation: true,
    scores: [], mainProblems: [], revisionSuggestions: [], complianceRisks: [], usableScenarios: [],
    createdAt: new Date().toISOString(),
  };
  await page.route('**/api/**', async (route) => {
    const path = route.request().url().replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    let body = null;
    let status = 200;
    if (path === '/api/auth/login') { status = 401; body = { message: '账号或密码错误' }; }
    else if (path === '/api/auth/me') body = { user };
    else if (path.endsWith('/content-review') && route.request().method() === 'POST') {
      triggers++; state = 'ai_content_reviewing'; polls = 0;
      body = { reviewId, status: 'running' };
    } else if (path.includes('/content-reviews/')) {
      if (++polls >= 2) state = 'pending_supervisor_review';
      body = { review: review(), videoStatus: state };
    } else if (path.endsWith('/content-review/latest')) body = { review: review(), videoStatus: state };
    else if (path.endsWith('/file-url')) body = { url: media };
    else if (path === `/api/videos/${id}`) body = {
      id, title: 'V1.01 本地验收视频', status: state, videoType: 'product_card',
      createdAt: new Date().toISOString(), creator: user, brand: '测试品牌', platform: '抖音',
      operationLogs: [], revisions: [], versionChain: [],
    };
    else if (path.includes('history')) body = { items: [], nextCursor: null };
    else if (path.endsWith('/result-review/latest')) body = { review: null, videoStatus: state };
    else if (path.endsWith('/rule-engine/latest')) body = { ruleEngineResult: null, videoStatus: state };
    else if (path.endsWith('/final-evaluation/latest')) body = { evaluation: null, videoStatus: state };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`http://127.0.0.1:3107/videos/${id}`);
  await page.getByRole('button', { name: '触发内容评估', exact: true }).waitFor();
  console.log('Fixture ready; no production requests. Trigger count:', triggers);
}
