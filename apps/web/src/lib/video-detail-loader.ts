type VideoDetailRequestOptions<TDetail, TLatest> = {
  loadDetail: () => Promise<TDetail>;
  loadLatest: () => Promise<TLatest>;
  onDetail: (detail: TDetail) => void;
  onLatest: (latest: TLatest) => void;
  onLatestError: () => void;
};

export async function loadVideoDetailRequests<TDetail, TLatest>(
  options: VideoDetailRequestOptions<TDetail, TLatest>,
) {
  const detail = await options.loadDetail();
  options.onDetail(detail);

  try {
    options.onLatest(await options.loadLatest());
  } catch {
    options.onLatestError();
  }
}
