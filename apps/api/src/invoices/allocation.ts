import { Prisma } from '@icon/database';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/**
 * Allocates on-account money from the job's payments (oldest first) to the
 * invoice's open balance (ADR 0022). Runs inside the caller's transaction; both
 * running totals are updated with conditional statements so concurrent calls can
 * never over-allocate (the database CHECKs are the last line of defence).
 * Returns the amount allocated.
 */
export async function autoAllocate(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; invoiceId: string; actorUserId: string },
): Promise<Decimal> {
  const [invoice] = await tx.$queryRaw<
    { id: string; job_id: string; customer_id: string; open: Prisma.Decimal }[]
  >`
    SELECT "id", "job_id", "customer_id", ("total" - "credited_total" - "allocated_total") AS "open"
    FROM "invoices"
    WHERE "id" = ${input.invoiceId}::uuid AND "organization_id" = ${input.organizationId}::uuid AND "status" = 'ISSUED'
    FOR UPDATE`;
  if (!invoice) return new D(0);
  let open = new D(invoice.open.toString());
  let allocated = new D(0);
  if (open.lte(0)) return allocated;
  const payments = await tx.$queryRaw<{ id: string; available: Prisma.Decimal }[]>`
    SELECT "id", ("amount" - "allocated_total" - "refunded_total") AS "available"
    FROM "payments"
    WHERE "organization_id" = ${input.organizationId}::uuid AND "job_id" = ${invoice.job_id}::uuid
      AND "customer_id" = ${invoice.customer_id}::uuid AND "status" = 'RECORDED'
      AND "amount" - "allocated_total" - "refunded_total" > 0
    ORDER BY "received_at", "id"
    FOR UPDATE`;
  for (const payment of payments) {
    if (open.lte(0)) break;
    const amount = D.min(open, new D(payment.available.toString()));
    await allocate(tx, { ...input, paymentId: payment.id, amount });
    open = open.minus(amount);
    allocated = allocated.plus(amount);
  }
  return allocated;
}

/** One allocation row + both running totals, guarded against over-allocation. */
export async function allocate(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    invoiceId: string;
    paymentId: string;
    amount: Decimal;
    actorUserId: string;
  },
): Promise<boolean> {
  const amount = input.amount.toFixed(4);
  const paymentUpdated = await tx.$executeRaw`
    UPDATE "payments" SET "allocated_total" = "allocated_total" + ${amount}::numeric
    WHERE "id" = ${input.paymentId}::uuid AND "organization_id" = ${input.organizationId}::uuid AND "status" = 'RECORDED'
      AND "amount" - "allocated_total" - "refunded_total" >= ${amount}::numeric`;
  if (paymentUpdated !== 1) return false;
  const invoiceUpdated = await tx.$executeRaw`
    UPDATE "invoices" SET "allocated_total" = "allocated_total" + ${amount}::numeric, "updated_at" = now()
    WHERE "id" = ${input.invoiceId}::uuid AND "organization_id" = ${input.organizationId}::uuid AND "status" = 'ISSUED'
      AND "total" - "credited_total" - "allocated_total" >= ${amount}::numeric`;
  if (invoiceUpdated !== 1) throw new Error('Invoice balance changed concurrently');
  await tx.paymentAllocation.create({
    data: {
      organizationId: input.organizationId,
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      amount,
      createdById: input.actorUserId,
    },
  });
  return true;
}

/** Releases one allocation (money returns to the customer's account). */
export async function releaseAllocation(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; allocationId: string; actorUserId: string; reason: string },
): Promise<{ paymentId: string; invoiceId: string; amount: Decimal } | null> {
  const allocation = await tx.paymentAllocation.findFirst({
    where: { id: input.allocationId, organizationId: input.organizationId, releasedAt: null },
  });
  if (!allocation) return null;
  const amount = allocation.amount.toFixed(4);
  const released = await tx.paymentAllocation.updateMany({
    where: { id: allocation.id, releasedAt: null },
    data: { releasedAt: new Date(), releasedById: input.actorUserId, releaseReason: input.reason },
  });
  if (released.count !== 1) return null;
  await tx.$executeRaw`UPDATE "payments" SET "allocated_total" = "allocated_total" - ${amount}::numeric WHERE "id" = ${allocation.paymentId}::uuid`;
  await tx.$executeRaw`UPDATE "invoices" SET "allocated_total" = "allocated_total" - ${amount}::numeric, "updated_at" = now() WHERE "id" = ${allocation.invoiceId}::uuid`;
  return {
    paymentId: allocation.paymentId,
    invoiceId: allocation.invoiceId,
    amount: allocation.amount,
  };
}
