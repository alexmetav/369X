-- Leverage is COMING SOON: only 1x trades until launch.
-- To launch later: update public.settings set lev_tiers = '[[2,25000],[3,100000],[5,250000],[10,1000000]]';
update public.settings set lev_tiers = '[[1,0]]' where id = 1;
