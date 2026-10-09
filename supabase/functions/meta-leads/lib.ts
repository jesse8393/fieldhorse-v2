// The deployed function has a copy of ../_shared/lib.ts in this folder.
// This shim keeps index.ts byte for byte identical to the live source while
// letting `supabase functions deploy meta-leads` resolve the import.
export * from "../_shared/lib.ts";
