export type CurrencyCode = "TWD" | "USD" | "JPY" | string;

export type Money = {
  amount_minor: number;
  currency: CurrencyCode;
};

export function money(amount_minor: number, currency: CurrencyCode = "TWD"): Money {
  if (!Number.isInteger(amount_minor)) {
    throw new Error("amount_minor must be an integer");
  }

  return { amount_minor, currency };
}

export function assertSameCurrency(values: Money[]): CurrencyCode {
  const first = values[0]?.currency;

  if (!first) {
    return "TWD";
  }

  for (const value of values) {
    if (value.currency !== first) {
      throw new Error("All money values must use the same currency");
    }
  }

  return first;
}

export function sumMoney(values: Money[]): Money {
  const currency = assertSameCurrency(values);
  const amount_minor = values.reduce((total, value) => total + value.amount_minor, 0);

  return { amount_minor, currency };
}
