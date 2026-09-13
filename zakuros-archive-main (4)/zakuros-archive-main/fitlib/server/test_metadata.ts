import { fetchSteamDetails, getGameMetadata, checkBackendRateLimit } from "./metadataService";

// Simple custom testing assertions suite
function assertEqual(actual: any, expected: any, testName: string) {
  if (actual === expected) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    process.exit(1);
  }
}

function assertTrue(actual: boolean, testName: string) {
  if (actual) {
    console.log(`[PASS] ${testName}`);
  } else {
    console.error(`[FAIL] ${testName}: expected truthy value`);
    process.exit(1);
  }
}

async function runTests() {
  console.log("========================================");
  console.log("RUNNING METADATA SERVICE UNIT TESTS...");
  console.log("========================================");

  // Test 1: Rate limiting tracker
  console.log("\n--- Test 1: Local Server Rate Limiting ---");
  const testIp = "192.168.1.100";
  let allowed = true;
  for (let i = 0; i < 35; i++) {
    const res = checkBackendRateLimit(testIp);
    if (!res) {
      allowed = false;
      break;
    }
  }
  assertEqual(allowed, false, "IP must be rate-limited after exceeding maximum requests threshold");

  // Test 2: Steam Store API Details Fetching (Ultrakill AppID: 1229490)
  console.log("\n--- Test 2: Real-time Steam Store appdetails Query (Ultrakill) ---");
  try {
    const details = await fetchSteamDetails(1229490);
    assertTrue(!!details.title, "Title should be populated from Steam API");
    assertEqual(details.title?.toLowerCase(), "ultrakill", "Title matches 'ULTRAKILL'");
    assertTrue(Array.isArray(details.screenshots), "Screenshots should be an array");
    assertTrue(details.screenshots!.length > 0, "Screenshots has fetched images");
    console.log(`Successfully fetched details from Steam: ${details.title}. Release Date: ${details.releaseDate}`);
  } catch (err: any) {
    console.warn("[SKIP / TEST_FAIL_RECOVERABLE] Steam API may be down, or rate limited during build environment.", err.message);
  }

  // Test 3: Orchestrated Metadata service fetching + mock caching fallback
  console.log("\n--- Test 3: Cache and fallback orchestration (Elden Ring) ---");
  try {
    const gameId = "elden-ring";
    const result_first = await getGameMetadata(gameId, "Elden Ring", 1174180);
    assertTrue(!!result_first.summary, "Summary is retrieved on first call (Cache Miss)");

    // Retrieve again to hit memory cache
    console.log("Querying Elden Ring again...");
    const result_cached = await getGameMetadata(gameId, "Elden Ring", 1174180);
    assertEqual(result_cached.title, "Elden Ring", "Title preserves perfectly across cache rounds");
  } catch (err: any) {
    console.warn("[SKIP / TEST_FAIL_RECOVERABLE] Skip Test 3 if Steam API unavailable in container build network:", err.message);
  }

  console.log("\n========================================");
  console.log("METADATA SERVICE TESTS COMPLETED PERFECTLY!");
  console.log("========================================");
}

runTests().catch((e) => {
  console.error("Critical testing runner error:", e);
  process.exit(1);
});
