export const createTaskIdentifiers = () => {
  const id = crypto.randomUUID();
  const compact = id.replace(/-/g, "").toUpperCase();
  return {
    id,
    publicOrderCode: `ORD-${compact.slice(0, 10)}`,
  };
};
