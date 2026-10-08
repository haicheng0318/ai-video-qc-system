export const resultMetricCommonFields = [
  'publishUrl',
  'publishDate',
  'dataStartDate',
  'dataEndDate',
  'dataScreenshotUrl',
] as const;

export const resultMetricNumericFields = [
  'impressions',
  'views',
  'clicks',
  'ctr',
  'productClicks',
  'productCtr',
  'spend',
  'cpc',
  'cpm',
  'orders',
  'gmv',
  'conversionRate',
  'cvr',
  'roi',
  'liveRoomEntries',
  'entryRate',
  'entryCost',
  'avgStaySeconds',
  'interactions',
  'liveOrders',
  'liveGmv',
  'threeSecondViewRate',
  'completionRate',
  'avgWatchSeconds',
  'likes',
  'comments',
  'shares',
  'saves',
  'followersGain',
  'brandSearchGrowth',
  'positiveCommentsCount',
] as const;
const resultMetricNumericFieldSet = new Set<string>(resultMetricNumericFields);

export const resultMetricTextFields = [
  'campaignName',
  'commentKeywords',
  'operatorNote',
  'deliveryNote',
  'planStatus',
] as const;

export const resultMetricDataFields = [
  ...resultMetricCommonFields,
  ...resultMetricTextFields,
  ...resultMetricNumericFields,
] as const;

export type ResultMetricField = (typeof resultMetricDataFields)[number];
type ResultMetricVideoType =
  | 'product_card'
  | 'qianchuan_ad'
  | 'live_room_traffic'
  | 'organic'
  | 'brand_seeding'
  | 'other';
export type ResultMetricFieldKind =
  | 'url'
  | 'date'
  | 'text'
  | 'count'
  | 'money2'
  | 'decimal4'
  | 'percentage'
  | 'roi';

export type ResultMetricFieldDefinition = {
  label: string;
  kind: ResultMetricFieldKind;
  group: '发布信息' | '流量互动' | '商品转化' | '投放成本' | '直播结果' | '补充说明';
  description?: string;
};

const field = (
  label: string,
  kind: ResultMetricFieldKind,
  group: ResultMetricFieldDefinition['group'],
  description?: string,
): ResultMetricFieldDefinition => ({ label, kind, group, description });

export const resultMetricFieldDefinitions: Record<ResultMetricField, ResultMetricFieldDefinition> = {
  publishUrl: field('发布链接', 'url', '发布信息'),
  publishDate: field('发布日期', 'date', '发布信息'),
  dataStartDate: field('数据开始日期', 'date', '发布信息'),
  dataEndDate: field('数据结束日期', 'date', '发布信息'),
  dataScreenshotUrl: field('数据截图链接', 'url', '发布信息'),
  campaignName: field('投放计划名称', 'text', '投放成本'),
  impressions: field('曝光量', 'count', '流量互动', '视频广告被平台计为展示的次数；同一用户多次看到可能重复计数。'),
  views: field('播放量', 'count', '流量互动', '被平台计为播放的次数；请统一使用起播、有效播放或指定时长口径。'),
  clicks: field('广告总点击量', 'count', '流量互动', '广告或指定组件的总点击次数，不等同于商品详情页点击。'),
  ctr: field('广告点击率（CTR）', 'percentage', '流量互动', '广告总点击量 ÷ 曝光量 × 100%。'),
  productClicks: field('商品点击量', 'count', '商品转化', '进入商品卡或商品详情页的点击次数；当前口径下不应高于广告总点击量。'),
  productCtr: field('商品点击率', 'percentage', '商品转化', '默认按商品点击量 ÷ 播放量 × 100%；平台口径不同时请在投放备注中说明。'),
  spend: field('投放消耗金额', 'money2', '投放成本', '数据周期内平台实际消耗的投放金额。'),
  cpc: field('平均点击成本（CPC）', 'decimal4', '投放成本', '投放消耗金额 ÷ 广告总点击量。'),
  cpm: field('千次曝光成本（CPM）', 'decimal4', '投放成本', '投放消耗金额 ÷ 曝光量 × 1000。'),
  orders: field('订单量', 'count', '商品转化'),
  gmv: field('成交金额', 'money2', '商品转化'),
  conversionRate: field('商品点击转化率', 'percentage', '商品转化', '订单量 ÷ 商品点击量 × 100%。'),
  cvr: field('广告点击转化率（CVR）', 'percentage', '商品转化', '订单量 ÷ 广告总点击量 × 100%。'),
  roi: field('投产比（ROI）', 'roi', '商品转化', '成交金额 ÷ 投放消耗金额。'),
  liveRoomEntries: field('直播间进入人数', 'count', '直播结果'),
  entryRate: field('进房率', 'percentage', '直播结果'),
  entryCost: field('进房成本', 'decimal4', '直播结果'),
  avgStaySeconds: field('平均停留秒数', 'count', '直播结果'),
  interactions: field('直播互动量', 'count', '直播结果'),
  liveOrders: field('直播成交订单', 'count', '直播结果'),
  liveGmv: field('直播成交金额', 'money2', '直播结果'),
  threeSecondViewRate: field('3 秒播放率', 'percentage', '流量互动'),
  completionRate: field('完播率', 'percentage', '流量互动'),
  avgWatchSeconds: field('平均观看时长', 'count', '流量互动', '单位为秒。'),
  likes: field('点赞量', 'count', '流量互动'),
  comments: field('评论量', 'count', '流量互动'),
  shares: field('转发量', 'count', '流量互动'),
  saves: field('收藏量', 'count', '流量互动'),
  followersGain: field('涨粉量', 'count', '流量互动'),
  brandSearchGrowth: field('品牌搜索增长量', 'count', '流量互动'),
  positiveCommentsCount: field('正向评论量', 'count', '流量互动'),
  commentKeywords: field('评论关键词', 'text', '补充说明'),
  operatorNote: field('运营备注', 'text', '补充说明'),
  deliveryNote: field('投放备注', 'text', '补充说明'),
  planStatus: field('投放计划状态', 'text', '补充说明'),
};

const productCardFields: ResultMetricField[] = [
  ...resultMetricCommonFields,
  'impressions', 'views', 'clicks', 'ctr', 'productClicks', 'productCtr',
  'orders', 'gmv', 'conversionRate', 'cvr', 'threeSecondViewRate',
  'completionRate', 'avgWatchSeconds', 'operatorNote',
];
const paidProductCardFields: ResultMetricField[] = [
  ...resultMetricCommonFields,
  'campaignName', 'impressions', 'views', 'clicks', 'ctr', 'productClicks',
  'productCtr', 'spend', 'cpc', 'cpm', 'orders', 'gmv', 'conversionRate',
  'cvr', 'roi', 'threeSecondViewRate', 'completionRate', 'avgWatchSeconds',
  'deliveryNote', 'planStatus',
];
const qianchuanFields: ResultMetricField[] = [
  ...resultMetricCommonFields,
  'campaignName', 'impressions', 'views', 'clicks', 'ctr', 'productClicks',
  'productCtr', 'spend', 'cpc', 'cpm', 'orders', 'gmv', 'conversionRate',
  'cvr', 'roi', 'threeSecondViewRate', 'completionRate', 'avgWatchSeconds',
  'deliveryNote', 'planStatus',
];
const liveRoomFields: ResultMetricField[] = [
  ...resultMetricCommonFields,
  'campaignName', 'impressions', 'views', 'clicks', 'ctr', 'spend', 'cpc',
  'cpm', 'roi', 'liveRoomEntries', 'entryRate', 'entryCost', 'avgStaySeconds',
  'interactions', 'liveOrders', 'liveGmv', 'threeSecondViewRate',
  'completionRate', 'avgWatchSeconds', 'deliveryNote', 'planStatus',
];
const organicFields: ResultMetricField[] = [
  ...resultMetricCommonFields,
  'impressions', 'views', 'clicks', 'ctr', 'productClicks', 'productCtr',
  'orders', 'gmv', 'conversionRate', 'threeSecondViewRate', 'completionRate',
  'avgWatchSeconds', 'likes', 'comments', 'shares', 'saves', 'followersGain',
  'operatorNote',
];
const brandFields: ResultMetricField[] = [
  ...resultMetricCommonFields,
  'impressions', 'views', 'clicks', 'ctr', 'threeSecondViewRate',
  'completionRate', 'avgWatchSeconds', 'likes', 'comments', 'shares', 'saves',
  'followersGain', 'brandSearchGrowth', 'positiveCommentsCount',
  'commentKeywords', 'operatorNote',
];

const coreFields: Record<Exclude<ResultMetricVideoType, 'other'>, ResultMetricField[]> = {
  product_card: ['views', 'productClicks', 'orders', 'gmv'],
  qianchuan_ad: ['impressions', 'clicks', 'spend', 'orders', 'gmv'],
  live_room_traffic: ['liveRoomEntries', 'spend', 'liveOrders', 'liveGmv'],
  organic: ['views', 'productClicks', 'orders', 'gmv', 'likes', 'comments', 'shares', 'saves'],
  brand_seeding: ['views', 'likes', 'comments', 'shares', 'saves', 'followersGain', 'brandSearchGrowth'],
};

export type ResultMetricTypeConfig = {
  fields: ResultMetricField[];
  coreFields: ResultMetricField[];
  responsibleRole: 'operator' | 'advertiser';
};

export function getResultMetricFieldConfig(
  videoType: ResultMetricVideoType,
  isForAds: boolean,
): ResultMetricTypeConfig {
  if (videoType === 'other') {
    const fields = isForAds ? qianchuanFields : organicFields;
    return {
      fields,
      coreFields: fields.filter((name) => resultMetricNumericFieldSet.has(name)),
      responsibleRole: isForAds ? 'advertiser' : 'operator',
    };
  }

  if (videoType === 'product_card' && isForAds) {
    return {
      fields: paidProductCardFields,
      coreFields: ['impressions', 'clicks', 'spend', 'orders', 'gmv'],
      responsibleRole: 'advertiser',
    };
  }

  const fieldsByType: Record<Exclude<ResultMetricVideoType, 'other'>, ResultMetricField[]> = {
    product_card: productCardFields,
    qianchuan_ad: qianchuanFields,
    live_room_traffic: liveRoomFields,
    organic: organicFields,
    brand_seeding: brandFields,
  };
  return {
    fields: fieldsByType[videoType],
    coreFields: coreFields[videoType],
    responsibleRole:
      videoType === 'qianchuan_ad' || videoType === 'live_room_traffic'
        ? 'advertiser'
        : 'operator',
  };
}
