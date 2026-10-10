/* =====================================================================
   369X SETTINGS
   This is the ONE file you edit to change names, numbers and links.
   You do not need to touch any other file to rebrand or retune.
   ===================================================================== */
const CONFIG = {
  // ---- mode ----------------------------------------------------------
  // true  = demo mode. Everything runs in the browser with test money.
  // false = use the shared Supabase database below (js/api-supabase.js).
  USE_MOCK: false,
  API_BASE: "",                     // e.g. "https://api.369x.io"

  // ---- live backend (Supabase) -------------------------------------
  // Fill these in and set USE_MOCK to false to use the shared database.
  // The key is the PUBLISHABLE key (safe to put in the website).
  SUPABASE_URL: "https://uprlwmaogmjurmlzdhez.supabase.co",
  SUPABASE_KEY: "sb_publishable_uL1HkDp5twMw7KqIS2PMJw_6ZOSVhOm",

  // ---- brand ---------------------------------------------------------
  SITE_NAME: "369X",
  SITE_URL: "https://369x.io",      // fallback for referral links (the live site uses its own address)
  TOKEN: "369X",                    // ticker of your token, shown as $369X
  STABLE: "USDT",                   // the stablecoin people trade with
  SOCIAL: {
    x: "https://x.com/x369official",
    telegram: "https://t.me/x369official",
    discord: ""                     // optional
  },

  // ---- smart contracts (on-chain mode) --------------------------------
  // When CHAIN_ON is true, markets, trading, the faucet and payouts run on
  // the blockchain through these contracts instead of the database.
  CHAIN_ON: true,
  CONTRACTS: {
    owner:  "0xb826527186f70382A3be618215DBe2B7955d61d4",
    usdt:   "0x3011487baF4c7c0D4745317de7A2F1305BD2FFA0",   // test USDT (faucet)
    token:  "0x822a5E3Ee4901694124F2aB35C695EA6c9219721",   // test $369X (faucet)
    market: "0x3C8a6DFF6Be5fDE0fDEE59cBC9e6E69650d84A09",   // Market369X
    vault:   "0xb1F5010cBa164fe1c9C871801854Ffe6d9eF3c79",  // Vault369X v2
    staking: "0xC123B837a583c79bcb1441a0B94383A7f203a7d0",  // Stake369X v2
    referral: "0x8588EbF2471A6cf622416E251A3c29832523bDF7"  // Referral369X
  },
  // public read-only RPC endpoints (tried in order)
  // vault + staking from before an upgrade: the website lets people withdraw from them
  CONTRACTS_OLD: { vault: "0x01681060c0179e60322D69F274F3cDbE83330971", staking: "0x79c163F2c33fdf0Db5e56723fe86961247048432" },
  // if you change these, also allow the new hosts in vercel.json (Content-Security-Policy connect-src)
  READ_RPCS: ["https://bsc-testnet-rpc.publicnode.com", "https://data-seed-prebsc-1-s1.bnbchain.org:8545", "https://data-seed-prebsc-2-s1.bnbchain.org:8545", "https://bsc-testnet.bnbchain.org", "https://bsc-testnet-dataseed.bnbchain.org"],

  // ---- network (BNB Smart Chain Testnet by default) ------------------
  CHAIN: {
    chainId: "0x61",                // 97 = BSC Testnet. Mainnet is "0x38" (56)
    chainName: "BNB Smart Chain Testnet",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
    blockExplorerUrls: ["https://testnet.bscscan.com"]
  },

  // ---- trading fees (fractions: 0.01 = 1%) ---------------------------
  CREATOR_FEE: 0.005,               // 0.5% of every trade goes to the market creator
  PROTOCOL_FEE: 0.01,               // 1% protocol fee ...
  LP_SHARE: 0.80,                   // ... of which 80% goes to vault depositors
  REF_DISCOUNT: 0.10,               // invited users pay 10% less in fees
  MAINTENANCE: 0.05,                // leveraged position is liquidated when equity < 5% of size

  // ---- leverage (COMING SOON: switched off until launch) -------------
  LEVERAGE_ENABLED: false,
  // when it launches, leverage unlocks by market volume: [maxLeverage, minVolume]
  LEVERAGE_TIERS: [[2, 25000], [3, 100000], [5, 250000], [10, 1000000]],
  LEVERAGE_MIN: 50,                 // smallest leveraged position, in USDT
  LEVERAGE_MAX: 2000,               // largest leveraged position, in USDT

  // ---- market creation -----------------------------------------------
  CREATE_BOND: 5000,                // $369X bond, returned when the market resolves cleanly (keep equal to the on-chain bondAmount)
  DEFAULT_LIQUIDITY: 5000,          // LMSR "b" for new markets (bigger = prices move less)

  // ---- faucet (demo / testnet only) ----------------------------------
  FAUCET_STABLE: 1000,
  FAUCET_TOKEN: 5000,
  FAUCET_COOLDOWN_H: 24,

  // ---- vault lock tiers ----------------------------------------------
  LOCKS: [
    { id: "flex", label: "Flex", days: 0,   mult: 1 },
    { id: "d90",  label: "90 days",  days: 90,  mult: 2 },
    { id: "d180", label: "180 days", days: 180, mult: 4 },
    { id: "d365", label: "365 days", days: 365, mult: 8 }
  ],
  VAULT_APY_HINT: 0.142,            // shown as an estimate in demo mode

  // ---- staking tiers (staked $369X -> fee discount) ------------------
  // discount applies to the protocol share of the fee only (litepaper v1.2)
  STAKE_TIERS: [
    { name: "Holder",          min: 0,      discount: 0 },
    { name: "Staker",          min: 1000,   discount: 0.10 },
    { name: "Power Staker",    min: 10000,  discount: 0.25 },
    { name: "Protocol Staker", min: 100000, discount: 0.50 }
  ],

  // ---- referral commission tiers (share of fees from your invites) ---
  REF_TIERS: [
    { name: "Starter", min: 0,      rate: 0.20 },
    { name: "Pro",     min: 25000,  rate: 0.25 },
    { name: "Elite",   min: 100000, rate: 0.30 },
    { name: "Legend",  min: 500000, rate: 0.35 }
  ],

  // ---- token page (litepaper v1.2: indicative design, final terms at TGE) --
  TOKEN_ADDRESS: "0x822a5E3Ee4901694124F2aB35C695EA6c9219721",   // test $369X on BSC Testnet
  TOKEN_SUPPLY: 369000000,          // hard cap, no mint function
  TOKEN_TGE_PCT: 7.26,              // available at TGE: sale tokens + deployed liquidity only
  TOKEN_LISTING: 0.30,              // listing target, USD
  TOKEN_SCHEDULE_MONTHS: 72,
  // [bucket, % of supply, colour, unlock schedule]
  TOKEN_ALLOCATION: [
    ["Ecosystem & Community Incentives", 18, "#7cf26a", "3-mo cliff · monthly to M60 · incl. 6% capped Compensation-Plan rewards"],
    ["ICO / Public Sale (incl. Founders)", 15, "#5fd6f2", "Tiered by phase: 10% / 20% / 30% at TGE"],
    ["Treasury / Foundation",            15, "#2fbf8f", "18-mo cliff · monthly to M66 · multisig"],
    ["Staking & Resolver Rewards",       12, "#6fe6c0", "Shared cap · monthly from TGE to M72 (≈615K/mo)"],
    ["Team & Advisors",                  12, "#8f7cf2", "12-mo cliff · monthly to M48"],
    ["Liquidity & Market Making",         8, "#b5f05a", "15M deployed at TGE · rest reserved for new listings"],
    ["Strategic Partners",                5, "#b9a4ff", "18-mo cliff · monthly to M42"],
    ["Security & Insurance Reserve",      5, "#55606a", "Locked · released only by governance"],
    ["Marketing & KOL",                   4, "#3fa7c9", "3-mo cliff · monthly to M27"],
    ["Exchange Launch & Listing",         3, "#c6f7e2", "Locked · used only for confirmed listing campaigns"],
    ["Launchpad Rewards",                 2, "#1f8f6a", "Hard-capped pool · 1-mo cliff · monthly to M25"],
    ["Testnet Airdrop",                   1, "#e9ffd9", "1-mo cliff · monthly to M7"]
  ],
  // token sale ladder: [stage, price, tokens, TGE unlock · cliff · monthly]
  TOKEN_SALE: [
    ["ICO Phase 1 (incl. Founders)", 0.10, 15000000, "10% · 3-mo cliff · 15 mo"],
    ["ICO Phase 2",                  0.15, 18000000, "20% · 2-mo cliff · 12 mo"],
    ["ICO Phase 3",                  0.20, 22350000, "30% · 1-mo cliff · 9 mo"]
  ],
  // mainnet fee design: 2% base on every buy and sell, split four ways
  FEE_PLAN: { protocol: 0.0085, creator: 0.005, depth: 0.004, lp: 0.0025, buyback: 0.30 }
};
