// Local fallback typing for the Supabase client.
// The checked-in generated types in this repo are currently incomplete,
// so the app uses a permissive shape here until the schema is regenerated.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = any;
