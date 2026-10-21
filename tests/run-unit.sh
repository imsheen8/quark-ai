#!/usr/bin/env bash
# اختبارات الوحدة السريعة (بلا متصفح ولا خوادم) — تُشغَّل في GitHub Actions قبل البناء. محليًا: bash tests/run-unit.sh
cd "$(dirname "$0")/.."
fail=0
for t in test_agent_engine test_errlog test_integrations_engine test_mail_engine test_managed test_memory_engine test_native test_ondevice test_research_engine test_skills_engine test_tasks_engine test_tasks_server; do
  if out=$(timeout 180 node "tests/$t.js" 2>&1); then echo "✓ $t — $(echo "$out" | tail -1)"; else echo "✗ $t"; echo "$out" | tail -15; fail=1; fi
done
if out=$(timeout 60 python3 tests/test_managed_errors.py 2>&1); then echo "✓ test_managed_errors — $(echo "$out" | tail -1)"; else echo "✗ test_managed_errors"; echo "$out" | tail -15; fail=1; fi
exit $fail
