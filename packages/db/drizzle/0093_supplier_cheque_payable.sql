-- Round 47: a supplier cheque dated after the day it was given waits in 2150 «شيكات مستحقة الدفع» until cleared. False on every older cheque (it left the bank at once).
ALTER TABLE "supplier_payments" ADD COLUMN "cheque_payable" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "cheque_actions" DROP CONSTRAINT "cheque_actions_source_check";--> statement-breakpoint
ALTER TABLE "cheque_actions" ADD CONSTRAINT "cheque_actions_source_check" CHECK ("source_type" IN ('sale', 'receipt', 'supplier_payment'));
