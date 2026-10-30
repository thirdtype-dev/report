import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSlot, delayedPublicationNotice } from '../scripts/briefing-slot.mjs';

test('approved delay is limited to the October 30 morning slot before close', () => {
  const args = { phase: 'pre_market', tradingDate: '2026-10-30', delayedDate: '2026-10-30', now: new Date('2026-10-30T11:00:00+09:00') };
  assert.equal(resolveSlot(args).key, 'briefing:2026-10-30:pre_market');
  assert.throws(() => resolveSlot({ ...args, delayedDate: '' }), /outside_phase/);
  assert.throws(() => resolveSlot({ ...args, now: new Date('2026-10-30T16:00:00+09:00') }), /outside_phase/);
  assert.throws(() => resolveSlot({ ...args, tradingDate: '2026-11-02', now: new Date('2026-11-02T11:00:00+09:00') }), /outside_phase/);
  assert.throws(() => resolveSlot({ ...args, phase: 'post_market' }), /outside_phase/);
  assert.throws(() => resolveSlot({ ...args, createdAt: '2026-10-29T00:00:00Z' }), /delayed_slot/);
});

test('delayed report distinguishes frozen information from actual publication', () => {
  const args = { phase: 'pre_market', date: '2026-10-30', approvedDate: '2026-10-30', publishedAt: '2026-10-30T02:11:12Z' };
  const notice = delayedPublicationNotice(args);
  assert.match(notice, /지연 발행/);
  assert.match(notice, /정보 기준: 2026-10-30 08:30 KST/);
  assert.match(notice, /실제 발행 시각: 2026-10-30 11:11:12 KST/);
  assert.equal(delayedPublicationNotice({ ...args, approvedDate: '' }), '');
  assert.equal(delayedPublicationNotice({ ...args, date: '2026-11-02' }), '');
});
