-- Starting markets. Volume and traders start at zero: everything you see is real activity.
with seed(id, q, cat, icon, p, b, ends, source) as (values
  ('btc-150k', 'Will Bitcoin trade above $150K before Dec 31, 2026?', 'Crypto', '₿', 0.41, 7000, date '2026-12-31', 'CoinGecko BTC/USD price'),
  ('fed-nov', 'Will the Fed cut rates at the November 2026 meeting?', 'Finance', '🏛', 0.62, 10000, date '2026-11-04', 'federalreserve.gov FOMC statement'),
  ('eth-6k', 'Will ETH close Q4 2026 above $6,000?', 'Crypto', 'Ξ', 0.33, 5000, date '2026-12-31', 'CoinGecko ETH/USD daily close'),
  ('ucl-rm', 'Will Real Madrid reach the Champions League quarter-finals?', 'Sports', '⚽', 0.71, 4000, date '2027-04-15', 'uefa.com official results'),
  ('house-26', 'Will Democrats win the US House in the 2026 midterms?', 'Politics', '🗳', 0.58, 15000, date '2026-11-03', 'AP race calls'),
  ('bnb-ath', 'Will BNB set a new all-time high before November 2026?', 'Crypto', '◆', 0.47, 3000, date '2026-10-31', 'CoinGecko BNB/USD price'),
  ('spx-7500', 'Will the S&P 500 close 2026 above 7,500?', 'Finance', '📈', 0.55, 6000, date '2026-12-31', 'S&P Dow Jones Indices close'),
  ('lakers-po', 'Will the Lakers make the 2027 NBA playoffs?', 'Sports', '🏀', 0.64, 3000, date '2027-04-12', 'nba.com standings'),
  ('gta6', 'Will GTA VI launch on its announced release date?', 'Culture', '🎮', 0.72, 4000, date '2026-11-19', 'Rockstar Games official announcement'),
  ('ind-aus', 'Will India win their next Test series against Australia?', 'Sports', '🏏', 0.52, 3000, date '2027-01-20', 'ESPNcricinfo series result'),
  ('hot-2026', 'Will 2026 be the hottest year on record globally?', 'World', '🌍', 0.44, 2500, date '2027-01-15', 'NASA GISS annual report'),
  ('starship', 'Will Starship complete a full booster and ship reuse in 2026?', 'World', '🚀', 0.29, 2500, date '2026-12-31', 'SpaceX official statement'),
  ('btc-sep', 'Did Bitcoin close September 2026 above $110K?', 'Crypto', '₿', 0.66, 3000, date '2026-09-30', 'CoinGecko BTC/USD monthly close')
)
insert into public.markets (id, q, cat, icon, ends, source, rules, b, q_y, q_n)
select id, q, cat, icon, ends, source,
  'Resolves YES if the outcome is confirmed by ' || source || ' by the end date. Otherwise resolves NO.',
  b, b * ln(p / (1 - p)), 0
from seed;

insert into public.price_ticks (market_id, p) select id, public.lmsr_price_yes(q_y, q_n, b) from public.markets;
