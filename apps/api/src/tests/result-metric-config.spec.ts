import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getResultMetricFieldConfig,
  resultMetricFieldDefinitions,
  resultMetricNumericFields,
  ResultMetricField,
} from '@ai-video-qc/shared';

const expectedFields: Record<string, string[]> = {
  product_card: ['views', 'productClicks', 'orders', 'gmv', 'operatorNote'],
  qianchuan_ad: ['campaignName', 'spend', 'cpc', 'cpm', 'roi', 'deliveryNote'],
  live_room_traffic: ['liveRoomEntries', 'entryRate', 'entryCost', 'liveOrders', 'liveGmv'],
  organic: ['views', 'likes', 'comments', 'shares', 'saves', 'operatorNote'],
  brand_seeding: ['brandSearchGrowth', 'positiveCommentsCount', 'commentKeywords'],
};

for (const [videoType, fields] of Object.entries(expectedFields)) {
  test(`${videoType} result metric field configuration is correct`, () => {
    const config = getResultMetricFieldConfig(videoType as Parameters<typeof getResultMetricFieldConfig>[0], false);
    for (const field of fields) assert.ok(config.fields.includes(field as ResultMetricField));
    assert.ok(config.fields.includes('dataStartDate'));
    assert.ok(config.fields.includes('dataEndDate'));
  });
}

test('other result metric configuration follows isForAds role and field grouping', () => {
  const operation = getResultMetricFieldConfig('other', false);
  const ads = getResultMetricFieldConfig('other', true);
  assert.equal(operation.responsibleRole, 'operator');
  assert.equal(ads.responsibleRole, 'advertiser');
  assert.ok(operation.fields.includes('operatorNote'));
  assert.ok(ads.fields.includes('deliveryNote'));
  assert.ok(!operation.fields.includes('spend'));
});

test('all configured metric fields have a UI definition and numeric core fields are recognized', () => {
  for (const field of getResultMetricFieldConfig('qianchuan_ad', true).fields) {
    assert.ok(resultMetricFieldDefinitions[field]);
  }
  assert.ok(resultMetricNumericFields.includes('spend'));
});
