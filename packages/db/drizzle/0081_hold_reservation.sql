-- Round 37, decision 14: a hold reserves its pieces. A hold or an accepted order keeps its pieces
-- reserved until it is sold or rejected, and from now a hold made at the till also lapses: this column
-- is the moment its reservation ends (null: no end, as every order before this one). Lapsing deletes
-- nothing, moves no stock and posts nothing; the pieces are simply available again.
ALTER TABLE "online_orders" ADD COLUMN "reserved_until" timestamp with time zone;
