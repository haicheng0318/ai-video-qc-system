export async function submitVideoRevision(
  request: (path: string, init?: RequestInit) => Promise<unknown>,
  parentVideoId: string,
  formData: FormData,
  navigate: (path: string) => void,
) {
  const result = await request(`/api/videos/${parentVideoId}/revisions`, {
    method: 'POST',
    body: formData,
  });
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') {
    throw new Error('返修版本上传结果无效。');
  }
  navigate(`/videos/${result.id}`);
  return result;
}
