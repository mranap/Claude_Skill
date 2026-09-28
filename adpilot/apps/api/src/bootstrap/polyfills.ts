import 'reflect-metadata';

// BigInt values (Meta budgets in minor units, byte sizes) are serialised as strings in JSON responses.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};
