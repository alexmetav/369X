# 369X

On-chain prediction market front end, inspired by WagerPredict, in 369X branding.
Plain HTML/CSS/JS with **no build step**: open it, edit it, deploy it.

## Features
| Page | What it does |
|---|---|
| **Markets** | Browse, search, filter by category/status, sort by volume/trending/new/ending |
| **Market page** | Live price chart, LMSR pricing, buy YES/NO, **1×–10× leverage**, liquidation price, activity feed, rules |
| **Create market** | Anyone posts a question with a $369X bond and earns 0.5% of every trade |
| **Portfolio** | Balances, open positions (close any time), P&L, history, markets you created |
| **Vault** | Deposit USDT that backs leverage. Flex / 90 / 180 / 365-day locks = 1× / 2× / 4× / 8× points |
| **Stake** | Stake $369X for fee discounts (up to 50%) and voting power |
| **Resolution** | Stakers vote on ended markets; correct voters earn rewards; positions settle automatically |
| **Rewards** | Points from every activity + 10 badges |
| **Leaderboard** | By profit, volume or points |
| **Affiliate** | Referral links, tiers up to 35%, claim earnings |
| **Token / Docs** | Tokenomics, utilities, full how-it-works guide |
| **Faucet** | Free test USDT + $369X every 24h (in the wallet menu) |

Wallets: MetaMask, Trust Wallet, Coinbase Wallet, Rabby and Binance Wallet all work and are switched to BSC Testnet automatically. With no wallet app installed, the site uses a demo wallet.

## Files
```
index.html        page layout (header, footer, menus)
css/styles.css    all styling
js/config.js      ⭐ THE ONLY FILE YOU NEED TO EDIT: names, fees, links, network, tiers
js/lmsr.js        price math (LMSR market maker)
js/api.js         data layer + demo engine (swap for real backend/contracts later)
js/wallet.js      wallet connection
js/app.js         all pages and buttons
assets/logo.png   your logo
```

## Run it on your computer
Double-clicking `index.html` works for a quick look. For a wallet to connect, use a local server instead:
```
python3 -m http.server 8000
```
then open http://localhost:8000

## Deploy
Push to GitHub, import the repo at vercel.com/new, and click Deploy. There are no settings to change.

## Status
**Demo mode** (`USE_MOCK: true`): everything works with test money saved in the visitor's browser.
To accept real funds you need smart contracts + a backend. See `SETUP-TASKS.md` for what's next.
