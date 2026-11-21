-- Round 52: «توصيل مجاني فوق مبلغ»: an order for delivery whose total reaches this amount (store currency, minor units) pays no courier fee. Null: no such offer.
ALTER TABLE "online_stores" ADD COLUMN IF NOT EXISTS "free_delivery_over_minor" bigint;
