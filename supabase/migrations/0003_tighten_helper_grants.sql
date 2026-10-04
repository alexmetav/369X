-- helpers are only called from inside other functions
revoke execute on function public.me_address(), public.require_uid() from authenticated;
