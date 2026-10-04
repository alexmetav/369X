# Your tasks (simple, one at a time)

Tick each box when you finish. Send me the answer in chat when a task says **"send me"**.

## 🟢 Part 1: Launch the demo site (about 30 minutes, free)

- [ ] **1. Make a Vercel account.** Go to https://vercel.com/signup and choose "Continue with GitHub".
- [ ] **2. Deploy.** On Vercel click **Add New → Project**, pick the `369X` repo, click **Deploy**. Wait 1 minute. You'll get a link like `369x.vercel.app`. **Send me the link.**
- [ ] **3. Install a wallet to test.** Add the MetaMask extension (https://metamask.io) to Chrome. Make a new wallet and write the 12 secret words on paper. **Never send these words to anyone, including me.**
- [ ] **4. Try the site.** Open your link → **Connect wallet** → approve the "switch network" popup → wallet menu → **Get test funds** → buy YES on any market. Tell me anything that looks wrong.

## 🟡 Part 2: Your brand details (send me the answers)

- [ ] **5. Domain.** Do you own `369x.io` (or another domain)? **Send me the domain name.** (Later I'll show you how to connect it in Vercel. It takes 5 minutes.)
- [ ] **6. Social links.** **Send me** your X/Twitter, Telegram and Discord links.
- [ ] **7. Token.** Is the token called **$369X**? Total supply? (Right now it's a placeholder: 3.69 billion.) **Send me** your real numbers, or say "keep placeholder".
- [ ] **8. Stablecoin.** Should people trade with **USDT** or **USDC**? **Send me** one word.
- [ ] **9. Fees.** The current settings: 0.5% to the creator, 1% to the protocol, 80% of the protocol fee to the vault, and a 10% referral discount. **Send me** "OK" or your numbers.
- [ ] **10. Starting markets.** **Send me** 10–20 questions you want live on day one (for example "Will BTC be above $150K on Dec 31, 2026?"), each with an end date and the website that decides the answer.

## 🔴 Part 3: Go real (real money, done together, step by step)

This part uses real money, so we do it slowly and test everything on testnet first.

- [ ] **11. Get free test BNB** for gas: https://www.bnbchain.org/en/testnet-faucet (paste your MetaMask address).
- [ ] **12. Make a separate "deployer" wallet** in MetaMask (Account 2). Only put test BNB in it. **Send me its public address** (starts with `0x`, safe to share).
- [ ] **13. Backend.** I recommend **Supabase**, which is free and already connected to this workspace. Make an account at https://supabase.com and create a project called `369x`. **Tell me when done.**
- [ ] **14. Legal check (important).** Prediction markets with real money are regulated or banned in many countries (including the USA and parts of Europe and Asia). Before real money, talk to a lawyer about where you can operate. I can't do this part for you.
- [ ] **15. Security audit.** Before mainnet, smart contracts should be audited by a professional firm. Budget for it.

## What I'll build next, after Part 1 and Part 2
1. Smart contracts for BSC Testnet: test USDT + $369X tokens, faucet, LMSR market, vault, staking, resolution voting.
2. Connect this website to those contracts (replace the demo engine in `js/api.js`).
3. A Supabase backend for market listings, the leaderboard, referrals and points.
4. Admin page to approve/feature markets.
