#!/usr/bin/env bash
# ============================================================
#  Sayve Local End-to-End Webhook Test
#  Fires simulated Meta Cloud API payloads at localhost:3000
# ============================================================

BASE_URL="http://localhost:3000"
VERIFY_TOKEN="sayve_webhook_secret_token"
TEST_PHONE="2348012345678"   # fake Nigerian number
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_pass() { echo -e "${GREEN}  ✅ PASS${NC} $1"; ((PASS++)); }
log_fail() { echo -e "${RED}  ❌ FAIL${NC} $1"; ((FAIL++)); }
log_info() { echo -e "${BLUE}  ℹ  ${NC} $1"; }
log_section() { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

# Helper: build a Meta-style incoming message payload
make_payload() {
  local MSG_TEXT="$1"
  cat <<EOF
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "ENTRY_ID_123",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "15551234567", "phone_number_id": "PHONE_ID" },
        "messages": [{
          "from": "${TEST_PHONE}",
          "id": "MSG_ID_$(date +%s%N)",
          "timestamp": "$(date +%s)",
          "text": { "body": "${MSG_TEXT}" },
          "type": "text"
        }]
      },
      "field": "messages"
    }]
  }]
}
EOF
}

# Helper: fire a POST to /webhook and capture HTTP status + body
send_message() {
  local LABEL="$1"
  local PAYLOAD="$2"
  local RESPONSE
  local HTTP_CODE

  HTTP_CODE=$(curl -s -o /tmp/sayve_resp.txt -w "%{http_code}" \
    -X POST "${BASE_URL}/webhook" \
    -H "Content-Type: application/json" \
    -d "${PAYLOAD}")

  RESPONSE=$(cat /tmp/sayve_resp.txt)
  echo "    HTTP ${HTTP_CODE} → ${RESPONSE}"
  echo "$HTTP_CODE"
}

# ─────────────────────────────────────────────
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Sayve Local Webhook E2E Test Suite     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"

# ─── 0. Health check ───────────────────────
log_section "0. Health Check"
HC=$(curl -s -o /tmp/sayve_health.txt -w "%{http_code}" "${BASE_URL}/")
HEALTH_BODY=$(cat /tmp/sayve_health.txt)
log_info "GET / → HTTP ${HC}: ${HEALTH_BODY}"
if [ "$HC" = "200" ]; then
  log_pass "Server is up and responding"
else
  log_fail "Server not reachable — is 'npm run dev' running on port 3000?"
  echo ""
  echo "Run: npm run dev   (in another terminal)"
  exit 1
fi

# ─── 1. Webhook Verification (GET) ─────────
log_section "1. Webhook Verification (GET /webhook)"
VERIFY_CODE=$(curl -s -o /tmp/sayve_verify.txt -w "%{http_code}" \
  "${BASE_URL}/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHALLENGE_ABC123")
VERIFY_BODY=$(cat /tmp/sayve_verify.txt)
log_info "GET /webhook?hub.mode=subscribe → HTTP ${VERIFY_CODE}: ${VERIFY_BODY}"
if [ "$VERIFY_CODE" = "200" ] && [ "$VERIFY_BODY" = "CHALLENGE_ABC123" ]; then
  log_pass "Webhook verification: challenge echoed back correctly"
else
  log_fail "Webhook verification failed (expected 200 + challenge echo)"
fi

# Wrong token test
BAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE_URL}/webhook?hub.mode=subscribe&hub.verify_token=WRONG_TOKEN&hub.challenge=XYZ")
log_info "GET /webhook with wrong token → HTTP ${BAD_CODE}"
if [ "$BAD_CODE" = "403" ]; then
  log_pass "Wrong token correctly rejected with 403"
else
  log_fail "Expected 403 for wrong token, got ${BAD_CODE}"
fi

# ─── 2. Receipt Image Message ──────────────
log_section "2. Receipt Photo Image Message"
IMAGE_PAYLOAD=$(cat <<EOF
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "ENTRY_ID",
    "changes": [{
      "value": {
        "messages": [{
          "from": "${TEST_PHONE}",
          "id": "MSG_IMG_001",
          "timestamp": "$(date +%s)",
          "type": "image",
          "image": { "id": "IMG_ID_123", "mime_type": "image/jpeg", "sha256": "abc", "caption": "" }
        }]
      },
      "field": "messages"
    }]
  }]
}
EOF
)
IMG_CODE=$(curl -s -o /tmp/sayve_img.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" \
  -H "Content-Type: application/json" \
  -d "${IMAGE_PAYLOAD}")
log_info "POST /webhook (receipt image) → HTTP ${IMG_CODE}"
if [ "$IMG_CODE" = "200" ]; then
  log_pass "Receipt photo message handled gracefully (200 OK)"
else
  log_fail "Expected 200 for receipt image message, got ${IMG_CODE}"
fi

# ─── 3. Onboarding — first message ─────────
log_section "3. Onboarding — New User First Message"
PAYLOAD=$(make_payload "Hello")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'Hello' → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Onboarding trigger: first message accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 4. Onboarding — business name ─────────
log_section "4. Onboarding — Business Name Response"
sleep 0.3
PAYLOAD=$(make_payload "Kemi Groceries")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'Kemi Groceries' (business name) → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Business name accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 5. Onboarding — currency ──────────────
log_section "5. Onboarding — Currency Selection"
sleep 0.3
PAYLOAD=$(make_payload "NGN")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'NGN' (currency) → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Currency accepted and onboarding complete (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 6. Log income transaction ─────────────
log_section "6. Log Income Transaction"
sleep 0.3
PAYLOAD=$(make_payload "sold 3 bags of rice for 45000")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'sold 3 bags of rice for 45000' → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Income transaction message accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 7. Log expense transaction ────────────
log_section "7. Log Expense Transaction"
sleep 0.3
PAYLOAD=$(make_payload "spent 5000 on transport")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'spent 5000 on transport' → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Expense transaction message accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 8. Category correction ────────────────
log_section "8. Category Correction"
sleep 0.3
PAYLOAD=$(make_payload "no, it's Rent")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST \"no, it's Rent\" → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Category correction accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 9. Summary query — this week ──────────
log_section "9. Summary Query — This Week"
sleep 0.3
PAYLOAD=$(make_payload "how much did I make this week")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'how much did I make this week' → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Weekly summary query accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 10. Summary query — this month ────────
log_section "10. Summary Query — This Month"
sleep 0.3
PAYLOAD=$(make_payload "show my expenses this month")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'show my expenses this month' → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Monthly summary query accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 11. Export request ────────────────────
log_section "11. Export / Report Request"
sleep 0.3
PAYLOAD=$(make_payload "send my report")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'send my report' → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Export request accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── 12. Completely unrecognised message ───
log_section "12. Unrecognised / Garbage Input"
sleep 0.3
PAYLOAD=$(make_payload "jghfksjdhfgksjdhfg 999 qqqq")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST garbage input → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Garbage input handled gracefully (200 OK, no crash)"
else
  log_fail "Expected 200 (graceful error), got ${CODE}"
fi

# ─── 13. Non-whatsapp_business_account object ─
log_section "13. Non-matching Object Type (should be ignored)"
WRONG_OBJ='{"object":"page","entry":[]}'
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${WRONG_OBJ}")
log_info "POST non-whatsapp object → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Non-whatsapp object ignored correctly (200 OK)"
else
  log_fail "Expected 200 for ignored object, got ${CODE}"
fi

# ─── 14. Audio / Voice Note Message ──────
log_section "14. Audio / Voice Note Message"
AUDIO_PAYLOAD=$(cat <<EOF
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "ENTRY_ID",
    "changes": [{
      "value": {
        "messages": [{
          "from": "${TEST_PHONE}",
          "id": "MSG_AUDIO_001",
          "timestamp": "$(date +%s)",
          "type": "audio",
          "audio": { "id": "AUDIO_MEDIA_ID_123", "mime_type": "audio/ogg; codecs=opus", "sha256": "abc123" }
        }]
      },
      "field": "messages"
    }]
  }]
}
EOF
)
AUDIO_CODE=$(curl -s -o /tmp/sayve_audio.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" \
  -H "Content-Type: application/json" \
  -d "${AUDIO_PAYLOAD}")
log_info "POST /webhook (audio/voice note) → HTTP ${AUDIO_CODE}"
if [ "$AUDIO_CODE" = "200" ]; then
  log_pass "Audio message handled gracefully (200 OK)"
else
  log_fail "Expected 200 for audio message, got ${AUDIO_CODE}"
fi

# ─── 15. Help Command ──────────────────────
log_section "15. Help Command"
sleep 0.3
PAYLOAD=$(make_payload "help")
CODE=$(curl -s -o /tmp/sayve_r.txt -w "%{http_code}" \
  -X POST "${BASE_URL}/webhook" -H "Content-Type: application/json" -d "${PAYLOAD}")
log_info "POST 'help' → HTTP ${CODE}"
if [ "$CODE" = "200" ]; then
  log_pass "Help command accepted (200 OK)"
else
  log_fail "Expected 200, got ${CODE}"
fi

# ─── Summary ───────────────────────────────
echo ""
echo -e "${YELLOW}══════════════════════════════════════════${NC}"
echo -e "  E2E RESULTS: ${GREEN}${PASS} passed${NC}  |  ${RED}${FAIL} failed${NC}"
echo -e "${YELLOW}══════════════════════════════════════════${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then exit 1; fi
