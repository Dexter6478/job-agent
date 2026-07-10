/**
 * followup-cadence.test.mjs - tests for China canonical follow-up cadence.
 *
 * Run: node followup-cadence.test.mjs
 */

import {
  computeNextFollowupDate,
  computeUrgency,
  normalizeStatus,
  addDays,
  parseDate,
  DEFAULT_CADENCE,
} from './followup-cadence.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

const APP = '2026-06-30';

eq(
  'contacted, no prior follow-up uses contacted_first',
  computeNextFollowupDate('contacted', APP, null, 0),
  addDays(parseDate(APP), DEFAULT_CADENCE.contacted_first),
);

eq(
  'contacted, with prior follow-up uses contacted_subsequent',
  computeNextFollowupDate('contacted', APP, '2026-07-02', 1),
  addDays(parseDate('2026-07-02'), DEFAULT_CADENCE.contacted_subsequent),
);

eq(
  'contacted becomes overdue after contacted_first days',
  computeUrgency('contacted', DEFAULT_CADENCE.contacted_first, null, 0),
  'overdue',
);

eq(
  'applied, no follow-ups uses applied_first',
  computeNextFollowupDate('applied', APP, null, 0),
  addDays(parseDate(APP), DEFAULT_CADENCE.applied_first),
);

eq(
  'applied becomes overdue after applied_first days',
  computeUrgency('applied', DEFAULT_CADENCE.applied_first, null, 0),
  'overdue',
);

eq(
  'interview1 prompts immediate interview preparation',
  computeUrgency('interview1', 0, null, 0),
  'urgent',
);

eq(
  'interview1 next action date is immediate',
  computeNextFollowupDate('interview1', APP, null, 0),
  APP,
);

eq(
  'legacy Responded normalizes to contacted',
  normalizeStatus('Responded'),
  'contacted',
);

eq(
  'legacy Interview normalizes to interview1',
  normalizeStatus('Interview'),
  'interview1',
);

eq(
  'legacy Applied still normalizes to applied',
  normalizeStatus('Applied'),
  'applied',
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
