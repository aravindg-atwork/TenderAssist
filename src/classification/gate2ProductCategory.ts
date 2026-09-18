export interface Gate2Result {
  gate: 'G2';
  result: 'PASS' | 'REJECT';
  reason_code: 'PRODUCT_CATEGORY_MATCH' | 'PRODUCT_CATEGORY_MISMATCH';
  product_category: string;
}

export function evaluateGate2(tenderProductCategory: string, configuredProductCategory: string): Gate2Result {
  const match = tenderProductCategory.trim().toLowerCase() === configuredProductCategory.trim().toLowerCase();
  return {
    gate: 'G2',
    result: match ? 'PASS' : 'REJECT',
    reason_code: match ? 'PRODUCT_CATEGORY_MATCH' : 'PRODUCT_CATEGORY_MISMATCH',
    product_category: tenderProductCategory,
  };
}
