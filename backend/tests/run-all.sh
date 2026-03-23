#!/bin/bash
# Run all test suites sequentially
cd "$(dirname "$0")/.."
FAIL=0

for f in tests/test-core.js tests/test-presence.js tests/test-rejoin.js tests/test-participant-rejoin.js tests/test-offline-delivery.js; do
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Running: $f"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  node "$f"
  if [ $? -ne 0 ]; then
    FAIL=1
  fi
  sleep 2
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAIL -eq 0 ]; then
  echo "🎉 ALL TEST SUITES PASSED"
else
  echo "⚠️  SOME TEST SUITES FAILED"
fi
exit $FAIL
