# Privacy

SwitchBord is a free router for paid agent APIs. It has no accounts, no sign-in and no API keys, and it never handles payments or wallet keys. This page covers the API and MCP server at `switchbord.vercel.app` and the site at `switchbord.xyz`.

## What we keep

| What | Why | How long |
|---|---|---|
| Live checks of sellers (which endpoint, up or down, status code, response time, price) | Ranking sellers and measuring how rankings change | Kept as history. These are about sellers, not about you |
| Reports you choose to send (`report_result` or `POST /report`): endpoint id, outcome, time taken, and optionally a payment tx hash and network | Ranking sellers by real use | Raw reports are folded into per-endpoint counts daily, then deleted |

We don't store the tasks you ask for, and we don't build profiles. The site sets no cookies. It uses Vercel Web Analytics, which counts page views and where visitors came from (referring site, country, device type, and the `?src=` tag on a link if there is one) without cookies and without following you across sites.

## What our host sees

The service runs on Vercel. Like any web host, Vercel processes standard request data (IP address, URL including the task text in a `GET /route` query, user agent, time) to serve and protect the service, and keeps short-lived logs under [its own privacy policy](https://vercel.com/legal/privacy-policy). We use those logs only to debug and to keep the service running.

## Sellers

When your agent calls a seller that SwitchBord suggested, that call goes straight from your agent to the seller. What the seller does with it is covered by the seller's own terms, not ours.

## Sharing

We don't sell or share personal data. Aggregate numbers (seller counts, health, prices) are shown publicly on the site and through the API.

## Contact

Questions or requests: open an issue at [github.com/6ixtyy/switchbord](https://github.com/6ixtyy/switchbord/issues). Security problems: see [SECURITY.md](SECURITY.md).

Last updated: 2026-10-20.
