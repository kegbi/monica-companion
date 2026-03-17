import { signServiceToken } from "@monica-companion/auth";

const JWT_SECRET = process.env.JWT_SECRET;
const BASE = "http://localhost:3002";

async function signToken(issuer, audience, subject, cid) {
  return signServiceToken({
    issuer,
    audience, 
    secret: JWT_SECRET,
    subject,
    correlationId: cid,
    ttlSeconds: 120
  });
}

async function check(name, fn) {
  try {
    const result = await fn();
    console.log(`CHECK ${name}: ${result}`);
  } catch (e) {
    console.log(`CHECK ${name}: ERROR ${e.message}`);
  }
}

// CHECK 5: Invalid body (missing contactRef) with valid auth
await check("5_invalid_body", async () => {
  const token = await signToken("telegram-bridge", "ai-router", "00000000-0000-0000-0000-000000000001", "smoke-5");
  const r = await fetch(`${BASE}/internal/resolve-contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-Correlation-ID": "smoke-5"
    },
    body: JSON.stringify({})
  });
  const body = await r.text();
  return `STATUS=${r.status} BODY=${body}`;
});

// CHECK 6: Wrong caller (scheduler instead of telegram-bridge)
await check("6_wrong_caller", async () => {
  const token = await signToken("scheduler", "ai-router", "00000000-0000-0000-0000-000000000001", "smoke-6");
  const r = await fetch(`${BASE}/internal/resolve-contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-Correlation-ID": "smoke-6"
    },
    body: JSON.stringify({ contactRef: "Mom", correlationId: "smoke-6" })
  });
  const body = await r.text();
  return `STATUS=${r.status} BODY=${body}`;
});

// CHECK 7: Valid auth and valid body (expect 502 since no real Monica user exists,
// or the upstream call will fail because there's no user in the DB)
await check("7_valid_request", async () => {
  const token = await signToken("telegram-bridge", "ai-router", "00000000-0000-0000-0000-000000000001", "smoke-7");
  const r = await fetch(`${BASE}/internal/resolve-contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-Correlation-ID": "smoke-7"
    },
    body: JSON.stringify({ contactRef: "Mom", correlationId: "smoke-7" })
  });
  const body = await r.text();
  return `STATUS=${r.status} BODY=${body}`;
});

// CHECK 8: Empty contactRef (expect 400)
await check("8_empty_contactref", async () => {
  const token = await signToken("telegram-bridge", "ai-router", "00000000-0000-0000-0000-000000000001", "smoke-8");
  const r = await fetch(`${BASE}/internal/resolve-contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-Correlation-ID": "smoke-8"
    },
    body: JSON.stringify({ contactRef: "", correlationId: "smoke-8" })
  });
  const body = await r.text();
  return `STATUS=${r.status} BODY=${body}`;
});

// CHECK 9: GET instead of POST (expect 404)
await check("9_wrong_method", async () => {
  const token = await signToken("telegram-bridge", "ai-router", "00000000-0000-0000-0000-000000000001", "smoke-9");
  const r = await fetch(`${BASE}/internal/resolve-contact`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-Correlation-ID": "smoke-9"
    }
  });
  return `STATUS=${r.status}`;
});

