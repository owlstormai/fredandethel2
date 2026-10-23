-- Web search is opt-out (product decision 2026-10-23). Only the model's query is
-- ever sent to search, never memories. Users who explicitly declined keep their choice.
ALTER TABLE preferences ALTER COLUMN search_enabled SET DEFAULT true;
UPDATE preferences p
   SET search_enabled = true
 WHERE p.search_enabled = false
   AND NOT EXISTS (
     SELECT 1 FROM consent_records c
      WHERE c.user_id = p.user_id AND c.scope = 'web_search'
      ORDER BY c.created_at DESC LIMIT 1
   );
