#!/usr/bin/env bash
# List SwitchBord's MCP tools over plain HTTP (streamable HTTP, stateless, no auth).
set -euo pipefail
curl -s -X POST "https://api.switchbord.xyz/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
echo
