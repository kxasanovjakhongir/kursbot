ALTER TABLE "access_grants" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "access_grants" ADD COLUMN "trial" BOOLEAN NOT NULL DEFAULT false;
