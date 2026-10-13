#!/usr/bin/env bash
# Ask SwitchBord which sellers to call for a task. Usage: ./route.sh "search the web"
set -euo pipefail
TASK="${1:-search the web}"
curl -sG "https://switchbord.vercel.app/route" \
  --data-urlencode "task=$TASK" \
  --data-urlencode "accepts=x402:base:usdc" \
  --data-urlencode "max_price=0.05" \
  --data-urlencode "limit=3" |
  jq '{mode, market, sellersMatched, candidates: [.candidates[] | {rank, service, method, url, priceUsd, charges, up: .health.ok}]}'
