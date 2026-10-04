/* =====================================================================
   369X SETTINGS
   This is the ONE file you edit to change names, numbers and links.
   You do not need to touch any other file to rebrand or retune.
   ===================================================================== */
const CONFIG = {
  // ---- mode ----------------------------------------------------------
  // true  = demo mode. Everything runs in the browser with test money.
  // false = talk to a real backend at API_BASE (see js/api.js).
  USE_MOCK: true,
  API_BASE: "",                     // e.g. "https://api.369x.io"

  // ---- live backend (Supabase) -------------------------------------
  // Fill these in and set USE_MOCK to false to use the shared database.
  // The key is the PUBLISHABLE key (safe to put in the website).
  SUPABASE_URL: "",
  SUPABASE_KEY: "",

  // ---- brand ---------------------------------------------------------
  SITE_NAME: "369X",
  SITE_URL: "https://369x.io",      // used in referral links
  TOKEN: "369X",                    // ticker of your token, shown as $369X
  STABLE: "USDT",                   // the stablecoin people trade with
  SOCIAL: {
    x: "https://x.com/",            // TODO: your X (Twitter) page
    telegram: "https://t.me/",      // TODO: your Telegram group
    discord: ""                     // optional
  },

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

  // leverage unlocks by market volume: [maxLeverage, minVolume]
  LEVERAGE_TIERS: [[2, 0], [3, 100000], [5, 250000], [10, 1000000]],

  // ---- market creation -----------------------------------------------
  CREATE_BOND: 1000,                // $369X bond, returned when the market resolves cleanly
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
  STAKE_TIERS: [
    { name: "None",    min: 0,      discount: 0 },
    { name: "Bronze",  min: 10000,  discount: 0.10 },
    { name: "Silver",  min: 50000,  discount: 0.25 },
    { name: "Gold",    min: 200000, discount: 0.50 }
  ],

  // ---- referral commission tiers (share of fees from your invites) ---
  REF_TIERS: [
    { name: "Starter", min: 0,      rate: 0.20 },
    { name: "Pro",     min: 25000,  rate: 0.25 },
    { name: "Elite",   min: 100000, rate: 0.30 },
    { name: "Legend",  min: 500000, rate: 0.35 }
  ],

  // ---- token page (PLACEHOLDER numbers, replace with your real plan) --
  TOKEN_ADDRESS: "",                // paste the token contract address after you deploy it
  TOKEN_SUPPLY: 3690000000,
  TOKEN_ALLOCATION: [
    ["Community airdrop", 10, "#7cf26a"],
    ["Liquidity mining",  20, "#6fe6c0"],
    ["Ecosystem & grants", 18, "#5fd6f2"],
    ["Treasury",          12, "#4a9be0"],
    ["Team (4y vesting)", 15, "#8f7cf2"],
    ["Investors",         15, "#c77cf2"],
    ["Exchange liquidity", 10, "#ff7a88"]
  ]
};
