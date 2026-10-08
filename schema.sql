-- The reader-vote database (Cloudflare D1 "catalogo-votes", bound as DB), as live. Create it with
--   npx wrangler d1 execute catalogo-votes --remote --file schema.sql
-- An entry is "<page>.<column>.<row>", as in catalogo_1849.csv: a re-layout that moves entries to other columns or
-- rows re-keys them, so once there are votes, remap them before deploying one.

-- Readings readers gave for an entry, with their votes; typed counts the votes that typed it in while nobody could
-- see it yet (not ours, not the other scan's, not two readers'); first_day is the day it was first given.
CREATE TABLE readings (entry TEXT NOT NULL, reading TEXT NOT NULL, votes INTEGER NOT NULL DEFAULT 0, typed INTEGER NOT NULL DEFAULT 0, first_day TEXT, PRIMARY KEY (entry, reading));
-- One vote per entry per voter: voter is a hash of a random code the browser made up, day the day it voted.
CREATE TABLE voters (entry TEXT NOT NULL, voter TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (entry, voter));
-- Readings that contain any of these words are refused.
CREATE TABLE blocked (word TEXT PRIMARY KEY);
