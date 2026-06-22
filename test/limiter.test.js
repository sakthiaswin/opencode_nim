import { TokenBucketLimiter } from "../src/limiter.js";
import assert from "node:assert";

async function main() {
  // Test 1: requests within RPM should not wait at all.
  {
    const l = new TokenBucketLimiter({ rpm: 5, tpm: 100000, safetyMarginPct: 0 });
    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      const r = await l.acquire(10);
      r.commit(10);
    }
    const elapsed = Date.now() - start;
    assert(elapsed < 200, `Expected near-instant for within-budget requests, took ${elapsed}ms`);
    console.log("PASS: 5 requests within RPM=5 budget completed instantly:", elapsed + "ms");
  }

  // Test 2: 6th request against RPM=5 should report a wait > 0.
  {
    const l = new TokenBucketLimiter({ rpm: 5, tpm: 100000, safetyMarginPct: 0 });
    for (let i = 0; i < 5; i++) {
      const r = await l.acquire(10);
      r.commit(10);
    }
    const msNeeded = l._msUntilCapacity(10, Date.now());
    assert(msNeeded > 0, "Expected positive wait time when RPM budget exhausted");
    assert(msNeeded <= 60000, "Wait should never exceed the 60s window");
    console.log("PASS: 6th request correctly computed wait of", msNeeded + "ms", "(would queue, not reject)");
  }

  // Test 3: TPM gating triggers wait even when RPM has room.
  {
    const l = new TokenBucketLimiter({ rpm: 100, tpm: 100, safetyMarginPct: 0 });
    const r1 = await l.acquire(80);
    r1.commit(80);
    const msNeeded = l._msUntilCapacity(50, Date.now()); // 80+50 > 100 tpm limit
    assert(msNeeded > 0, "Expected TPM-driven wait even though RPM has room");
    console.log("PASS: TPM-only exhaustion correctly triggers wait:", msNeeded + "ms");
  }

  // Test 4: estimate-then-reconcile via commit() changes effective token usage.
  {
    const l = new TokenBucketLimiter({ rpm: 100, tpm: 1000, safetyMarginPct: 0 });
    const r = await l.acquire(900); // big estimate
    r.commit(50); // actual usage was much smaller
    const sum = l._currentTokenSum(Date.now());
    assert.strictEqual(sum, 50, `Expected reconciled token sum of 50, got ${sum}`);
    console.log("PASS: commit() correctly reconciles estimate (900) down to actual (50)");
  }

  // Test 5: release() fully frees a reservation (e.g. for failed upstream calls).
  {
    const l = new TokenBucketLimiter({ rpm: 5, tpm: 1000, safetyMarginPct: 0 });
    const r = await l.acquire(500);
    r.release();
    const sum = l._currentTokenSum(Date.now());
    const count = l._currentRequestCount(Date.now());
    assert.strictEqual(sum, 0, "Expected token reservation fully released");
    assert.strictEqual(count, 0, "Expected request reservation fully released");
    console.log("PASS: release() fully frees both RPM and TPM reservations");
  }

  // Test 6: safety margin actually reduces effective limits.
  {
    const l = new TokenBucketLimiter({ rpm: 100, tpm: 100000, safetyMarginPct: 10 });
    assert.strictEqual(l.rpmLimit, 90, `Expected 90 effective RPM with 10% margin, got ${l.rpmLimit}`);
    console.log("PASS: safety margin correctly reduces effective RPM (100 -> 90)");
  }

  // Test 7: concurrent acquire() calls queue fairly (FIFO) and all eventually resolve.
  {
    const l = new TokenBucketLimiter({ rpm: 1000, tpm: 1000000, safetyMarginPct: 0 });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => l.acquire(10).then((r) => { r.commit(10); return i; }))
    );
    assert.strictEqual(results.length, 20);
    console.log("PASS: 20 concurrent acquires under generous budget all resolved without deadlock");
  }

  console.log("\nAll limiter unit tests passed.");
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
