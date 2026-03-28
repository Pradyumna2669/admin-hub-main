DROP POLICY IF EXISTS "Users can delete their reddit accounts" ON public.reddit_accounts;
CREATE POLICY "Users can delete their reddit accounts"
  ON public.reddit_accounts FOR DELETE
  USING (auth.uid() = user_id);
